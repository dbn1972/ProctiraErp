/**
 * Scholarship application file routes.
 *
 *   POST   /scholarships/applications/:id/documents
 *   GET    /scholarships/applications/:id/documents
 *   GET    /scholarships/applications/:id/documents/:documentId/download
 *   GET    /scholarships/applications/:id/documents/:documentId/content
 *   DELETE /scholarships/applications/:id/documents/:documentId
 *   POST   /scholarships/applications/:id/documents/:documentId/verify
 *   POST   /scholarships/applications/:id/documents/:documentId/reject
 *   POST   /scholarships/applications/:id/submit
 *   GET    /scholarships/document-downloads?token=
 */
import { AppError, ValidationError } from '@proctira/common';
import { validate } from '@proctira/validation';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  actorFromRequest,
  assertCanCreateApplication,
  assertCanDelete,
  assertCanFinalize,
  assertCanReadDocuments,
  assertCanUpload,
  assertCanVerify,
  type ScholarshipActor,
} from './document-access.js';
import {
  DownloadTokenReplayGuard,
  parseMultipartForm,
  verifyDocumentDownloadToken,
} from './document-bytes.js';
import type { ScholarshipDocumentService } from './document-service.js';
import type { ScholarshipService } from './scholarship-service.js';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

const IdParams = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});
const DocParams = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
  documentId: Type.String({ pattern: UUID_PATTERN }),
});
const TokenQuery = Type.Object({
  token: Type.String({ minLength: 10, maxLength: 4000 }),
});
const RejectBody = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 1000 }),
});

const UPLOAD_LIMIT = 11 * 1024 * 1024;

export interface ScholarshipDocumentRouteOptions {
  scholarshipService: ScholarshipService;
  documentService: ScholarshipDocumentService;
  prefix?: string;
  resolveLinkedStudentIds?: (tenantId: string, userId: string) => Promise<string[]>;
  /** Single-use download token guard (PRC-L344). Defaults to a process-local guard. */
  downloadReplayGuard?: DownloadTokenReplayGuard;
}

function tenantIdOf(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

function requireTenant(request: FastifyRequest, reply: FastifyReply): string | null {
  const tenantId = tenantIdOf(request);
  if (!tenantId) {
    void reply.status(400).send({
      code: 'TENANT_REQUIRED',
      message: 'Tenant context is required',
      statusCode: 400,
    });
    return null;
  }
  return tenantId;
}

export async function registerScholarshipDocumentRoutes(
  fastify: FastifyInstance,
  options: ScholarshipDocumentRouteOptions,
): Promise<void> {
  const prefix = options.prefix ?? '/scholarships';
  const { scholarshipService, documentService } = options;
  const replayGuard = options.downloadReplayGuard ?? new DownloadTokenReplayGuard();

  if (!fastify.hasContentTypeParser('multipart/form-data')) {
    fastify.addContentTypeParser(
      'multipart/form-data',
      { parseAs: 'buffer', bodyLimit: UPLOAD_LIMIT },
      (_request, body, done) => {
        done(null, body);
      },
    );
  }

  async function actorFor(request: FastifyRequest, tenantId: string): Promise<ScholarshipActor> {
    const base = actorFromRequest(request);
    if (!options.resolveLinkedStudentIds || !base.userId) return base;
    try {
      const linked = await options.resolveLinkedStudentIds(tenantId, base.userId);
      return actorFromRequest(request, linked);
    } catch {
      return base;
    }
  }

  async function loadApplication(tenantId: string, id: string) {
    return scholarshipService.getApplicationById(tenantId, id);
  }

  fastify.post(
    `${prefix}/applications/:id/documents`,
    { bodyLimit: UPLOAD_LIMIT },
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(IdParams, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const application = await loadApplication(tenantId, params.data.id);
        const actor = await actorFor(request, tenantId);
        assertCanUpload(actor, application);
        const contentType = request.headers['content-type'] ?? '';
        const body = request.body;
        if (!Buffer.isBuffer(body)) {
          throw new ValidationError('Upload must be multipart/form-data', [
            { field: 'file', rule: 'contentType', message: 'Expected a multipart file upload' },
          ]);
        }
        const parsed = parseMultipartForm(body, contentType);
        if (!parsed.file) {
          throw new ValidationError('A file is required', [
            { field: 'file', rule: 'required', message: 'Choose a PDF, JPEG, or PNG to upload' },
          ]);
        }
        const documentType = parsed.fields['documentType'] ?? '';
        const created = await documentService.upload({
          tenantId,
          application,
          actor,
          documentType,
          filename: parsed.file.filename,
          declaredMime: parsed.file.mimeType,
          bytes: parsed.file.data,
        });
        return reply.status(201).send(created);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(`${prefix}/applications/:id/documents`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const params = validate(IdParams, request.params);
    if (!params.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: params.errors,
      });
    }
    try {
      const application = await loadApplication(tenantId, params.data.id);
      const actor = await actorFor(request, tenantId);
      assertCanReadDocuments(actor, application);
      const data = await documentService.list(tenantId, application.id);
      return reply.send({ data });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(
    `${prefix}/applications/:id/documents/:documentId/download`,
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(DocParams, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const application = await loadApplication(tenantId, params.data.id);
        const actor = await actorFor(request, tenantId);
        assertCanReadDocuments(actor, application);
        const doc = await documentService.downloadDescriptor(tenantId, params.data.documentId, {
          userId: actor.userId,
        });
        if (!doc) return;
        const listed = await documentService.list(tenantId, application.id);
        if (!listed.some((row) => row.id === params.data.documentId)) {
          return reply.status(404).send({
            code: 'NOT_FOUND',
            message: 'Document not found',
            statusCode: 404,
          });
        }
        return reply.send({
          url: doc.url,
          expiresAt: doc.expiresAt,
          mimeType: doc.mimeType,
          originalFilename: doc.originalFilename,
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/applications/:id/documents/:documentId/content`,
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(DocParams, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const application = await loadApplication(tenantId, params.data.id);
        const actor = await actorFor(request, tenantId);
        assertCanReadDocuments(actor, application);
        const file = await documentService.readBytes(tenantId, params.data.documentId);
        const listed = await documentService.list(tenantId, application.id);
        if (!listed.some((row) => row.id === params.data.documentId)) {
          return reply.status(404).send({
            code: 'NOT_FOUND',
            message: 'Document not found',
            statusCode: 404,
          });
        }
        return reply
          .header('content-type', file.mimeType)
          .header(
            'content-disposition',
            `attachment; filename="${file.originalFilename.replace(/"/g, '')}"`,
          )
          .send(file.bytes);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(`${prefix}/applications/:id/documents/:documentId`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const params = validate(DocParams, request.params);
    if (!params.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: params.errors,
      });
    }
    try {
      const application = await loadApplication(tenantId, params.data.id);
      const actor = await actorFor(request, tenantId);
      assertCanDelete(actor, application);
      await documentService.remove(tenantId, params.data.documentId, actor);
      return reply.status(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(
    `${prefix}/applications/:id/documents/:documentId/verify`,
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(DocParams, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        await loadApplication(tenantId, params.data.id);
        const actor = await actorFor(request, tenantId);
        assertCanVerify(actor);
        const updated = await documentService.verify(tenantId, params.data.documentId, actor);
        return reply.send(updated);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/applications/:id/documents/:documentId/reject`,
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(DocParams, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(RejectBody, request.body ?? {});
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'A rejection reason is required',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        await loadApplication(tenantId, params.data.id);
        const actor = await actorFor(request, tenantId);
        assertCanVerify(actor);
        const updated = await documentService.reject(
          tenantId,
          params.data.documentId,
          actor,
          body.data.reason,
        );
        return reply.send(updated);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(`${prefix}/applications/:id/submit`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const params = validate(IdParams, request.params);
    if (!params.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: params.errors,
      });
    }
    try {
      const application = await loadApplication(tenantId, params.data.id);
      const actor = await actorFor(request, tenantId);
      assertCanFinalize(actor, application);
      const uploaded = await documentService.list(tenantId, application.id);
      const accepted = uploaded.filter((doc) => doc.verificationStatus !== 'REJECTED');
      const updated = await scholarshipService.finalizeDraft(
        tenantId,
        application.id,
        accepted.map((doc) => doc.documentType),
        accepted.map((doc) => ({
          documentType: doc.documentType,
          fileName: doc.originalFilename,
          fileUrl: `scholarship-document:${doc.id}`,
          fileSize: doc.sizeBytes,
        })),
      );
      return reply.send({
        ...updated,
        submittedAt: updated.submittedAt.toISOString(),
        reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(
    `${prefix}/document-downloads`,
    // Route-level limit on top of the global gateway limiter (PRC-L344).
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const params = validate(TokenQuery, request.query);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Download link is invalid',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const claims = verifyDocumentDownloadToken(params.data.token);
        // A session presented with the link must be the user it was minted for.
        const sessionUser = actorFromRequest(request).userId;
        if (sessionUser && claims.sub && sessionUser !== claims.sub) {
          return reply.status(403).send({
            code: 'FORBIDDEN',
            message: 'This download link was issued to another user',
            statusCode: 403,
          });
        }
        if (!replayGuard.consume(claims.jti, claims.exp)) {
          return reply.status(401).send({
            code: 'UNAUTHORIZED',
            message: 'Download link has already been used',
            statusCode: 401,
          });
        }
        const file = await documentService.readBytes(claims.tenantId, claims.documentId);
        request.log.info(
          {
            event: 'scholarship.document.downloaded',
            tenantId: claims.tenantId,
            documentId: claims.documentId,
            userId: claims.sub || null,
            jti: claims.jti,
          },
          'scholarship document downloaded',
        );
        return reply
          .header('content-type', file.mimeType)
          .header('cache-control', 'private, max-age=0')
          .header(
            'content-disposition',
            `attachment; filename="${file.originalFilename.replace(/"/g, '')}"`,
          )
          .send(file.bytes);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}

/** Used by the application create route so parents can file only for linked students. */
export async function authorizeApplicationCreate(
  request: FastifyRequest,
  reply: FastifyReply,
  applicantId: string,
  resolveLinkedStudentIds?: (tenantId: string, userId: string) => Promise<string[]>,
): Promise<boolean> {
  const tenantId = tenantIdOf(request);
  if (!tenantId) {
    void reply.status(400).send({
      code: 'TENANT_REQUIRED',
      message: 'Tenant context is required',
      statusCode: 400,
    });
    return false;
  }
  let actor = actorFromRequest(request);
  if (resolveLinkedStudentIds && actor.userId) {
    try {
      actor = actorFromRequest(request, await resolveLinkedStudentIds(tenantId, actor.userId));
    } catch {
      // JWT claims still apply when the link table is unavailable.
    }
  }
  try {
    assertCanCreateApplication(actor, applicantId);
    return true;
  } catch (error) {
    sendError(reply, error);
    return false;
  }
}
