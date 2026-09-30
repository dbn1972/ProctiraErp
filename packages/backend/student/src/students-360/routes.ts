/**
 * G-914 — Students 360 routes (mounted under the students prefix).
 *
 * POST   /students/:id/photo
 * GET    /students/:id/photo
 * GET    /students/:id/id-card.pdf
 * GET    /students/:id/siblings
 * POST   /students/:id/siblings
 * DELETE /students/:id/siblings/:siblingId
 * GET    /students/:id/consents
 * PUT    /students/:id/consents
 * GET    /students/:id/discipline
 * POST   /students/:id/discipline
 * DELETE /students/:id/discipline/:incidentId
 * GET    /students/:id/attendance-heatmap
 * POST   /students/:id/documents          (W2-SIS-03)
 * GET    /students/:id/documents          (W2-SIS-03)
 * GET    /students/:id/documents/:docId   (W2-SIS-03)
 * DELETE /students/:id/documents/:docId   (W2-SIS-03)
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { StudentParamsSchema } from '../schemas.js';
import {
  isDisciplineStaff,
  isMedicalStaff,
  isRegistrarOrAdmin,
  isStudentReadStaff,
  resolveStudentReadScope,
  type StudentPortalBinding,
} from '../student-portal-access.js';

import {
  CreateDisciplineSchema,
  CreateSiblingSchema,
  DocumentParamsSchema,
  HeatmapQuerySchema,
  SetConsentSchema,
  UploadDocumentSchema,
  UploadPhotoSchema,
  type CreateDisciplineDto,
  type CreateSiblingDto,
  type DocumentParamsDto,
  type HeatmapQueryDto,
  type SetConsentDto,
  type UploadDocumentDto,
  type UploadPhotoDto,
} from './schemas.js';
import type { Students360Service } from './service.js';
import type {
  ConsentRecord,
  DisciplineRecord,
  DocumentRecord,
  PhotoRecord,
  SiblingRecord,
} from './store.js';

export interface Students360RoutesOptions {
  service: Students360Service;
  prefix?: string;
  /** PRC-C011: portal ownership binding (guardian/parent → children, student → self). */
  studentBinding?: StudentPortalBinding;
}

function tenantOf(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function actorOf(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string; userId?: string } }).user;
  return user?.sub ?? user?.userId ?? 'system';
}

function rolesOf(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

function forbid(reply: FastifyReply, message = 'Forbidden') {
  return reply.status(403).send({ code: 'FORBIDDEN', message, statusCode: 403 });
}

function notFoundStudent(reply: FastifyReply) {
  return reply.status(404).send({ code: 'NOT_FOUND', message: 'Student not found', statusCode: 404 });
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

function tenantRequired(reply: FastifyReply) {
  return reply
    .status(400)
    .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
}

function formatPhoto(photo: PhotoRecord) {
  return {
    id: photo.id,
    studentId: photo.studentId,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes,
    uploadedBy: photo.uploadedBy,
    createdAt: photo.createdAt.toISOString(),
  };
}

function formatSibling(row: SiblingRecord) {
  return {
    id: row.id,
    studentId: row.studentId,
    siblingId: row.siblingId,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatConsent(row: ConsentRecord) {
  return {
    id: row.id,
    studentId: row.studentId,
    kind: row.kind,
    granted: row.granted,
    actorId: row.actorId,
    recordedAt: row.recordedAt.toISOString(),
  };
}

function formatDiscipline(row: DisciplineRecord) {
  return {
    id: row.id,
    studentId: row.studentId,
    incidentType: row.incidentType,
    severity: row.severity,
    description: row.description,
    actionTaken: row.actionTaken,
    reporterId: row.reporterId,
    incidentDate: row.incidentDate,
    visibleToParent: row.visibleToParent,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatDocument(row: DocumentRecord) {
  return {
    id: row.id,
    studentId: row.studentId,
    category: row.category,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerStudents360Routes(
  fastify: FastifyInstance,
  options: Students360RoutesOptions,
): Promise<void> {
  const { service, prefix = '/students', studentBinding } = options;

  /**
   * PRC-C011: central authorization for every students-360 route. These routes were previously
   * open to any authenticated caller. Rules:
   *  - all routes require the caller to be able to read the target student (staff, or a portal
   *    owner via the binding); otherwise 403 (no scope) / 404 (not their student).
   *  - mutations (POST/PUT/DELETE) require staff — portal owners are read-only here.
   *  - sensitive sub-resources: documents require medical/registrar staff (or the owning
   *    guardian for read); discipline writes require discipline staff; consents writes require
   *    registrar/admin. (Per-route refinement below the ownership gate.)
   */
  fastify.addHook('preHandler', async (request, reply) => {
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS' || method === 'HEAD') return;

    const tenantId = tenantOf(request);
    if (!tenantId) return; // handler returns TENANT_REQUIRED

    // The student id is the first :id path segment for every 360 route.
    const studentId = (request.params as { id?: string } | undefined)?.id;
    if (!studentId) return; // let the handler's schema validation produce 400

    const roles = rolesOf(request);
    const staff = isStudentReadStaff(roles);

    // Mutations are staff-only.
    const isWrite = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (isWrite && !staff) {
      forbid(reply, 'Forbidden: portal roles cannot modify student records');
      return;
    }

    // Ownership: staff pass; portal readers must own the target student.
    if (!staff) {
      const scope = await resolveStudentReadScope(
        roles,
        actorOf(request),
        tenantId,
        studentBinding,
      );
      if (scope.kind === 'denied') {
        forbid(reply, 'Forbidden: role cannot read student records');
        return;
      }
      if (scope.kind === 'self' && !scope.studentIds.has(studentId)) {
        notFoundStudent(reply);
        return;
      }
    }

    // Sensitive sub-resources: student documents may contain medical/legal records and are
    // restricted to medical/registrar staff — no portal reader and no non-medical staff.
    const url = request.url;
    if (url.includes('/documents') && !isMedicalStaff(roles)) {
      forbid(reply, 'Forbidden: student documents require registrar/nurse/admin');
      return;
    }
    // Consent writes require registrar/admin.
    if (url.includes('/consents') && isWrite && !isRegistrarOrAdmin(roles)) {
      forbid(reply, 'Forbidden: consents require registrar/admin');
      return;
    }
    // Discipline writes require discipline staff.
    if (url.includes('/discipline') && isWrite && !isDisciplineStaff(roles)) {
      forbid(reply, 'Forbidden: discipline requires teacher/registrar/admin');
      return;
    }
  });

  fastify.post(
    `${prefix}/:id/photo`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UploadPhotoDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(UploadPhotoSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid photo payload',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const photo = await service.uploadPhoto(
          tenantId,
          params.data.id,
          body.data,
          actorOf(request),
        );
        return reply.status(201).send(formatPhoto(photo));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/photo`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const { bytes, mimeType, signedUrl } = await service.getPhotoBytes(
          tenantId,
          params.data.id,
        );
        if (signedUrl) {
          return reply.status(200).send({ url: signedUrl, mimeType });
        }
        return reply
          .status(200)
          .header('content-type', mimeType)
          .header('cache-control', 'private, no-store')
          .send(bytes);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/id-card.pdf`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const pdf = await service.renderIdCardPdf(tenantId, params.data.id);
        return reply
          .status(200)
          .header('content-type', 'application/pdf')
          .header(
            'content-disposition',
            `attachment; filename="student-${params.data.id}-id-card.pdf"`,
          )
          .header('cache-control', 'private, no-store')
          .send(pdf);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/siblings`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const rows = await service.listSiblings(tenantId, params.data.id);
        return reply.status(200).send({ data: rows.map(formatSibling) });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/siblings`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: CreateSiblingDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(CreateSiblingSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid sibling',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const row = await service.addSibling(tenantId, params.data.id, body.data);
        return reply.status(201).send(formatSibling(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    `${prefix}/:id/siblings/:siblingId`,
    async (
      request: FastifyRequest<{ Params: { id: string; siblingId: string } }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, { id: request.params.id });
      const sibling = validate(StudentParamsSchema, { id: request.params.siblingId });
      if (!params.success || !sibling.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
        });
      }
      try {
        await service.removeSibling(tenantId, params.data.id, sibling.data.id);
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/consents`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const rows = await service.listConsents(tenantId, params.data.id);
        return reply.status(200).send({ data: rows.map(formatConsent) });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    `${prefix}/:id/consents`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: SetConsentDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(SetConsentSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid consent',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const row = await service.setConsent(tenantId, params.data.id, body.data, actorOf(request));
        return reply.status(200).send(formatConsent(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/discipline`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const rows = await service.listDiscipline(tenantId, params.data.id);
        // PRC-C011: a portal reader (owning guardian/student) only sees incidents explicitly
        // marked visibleToParent; staff discipline roles see all.
        const visible = isDisciplineStaff(rolesOf(request))
          ? rows
          : rows.filter((row) => row.visibleToParent);
        return reply.status(200).send({ data: visible.map(formatDiscipline) });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/discipline`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: CreateDisciplineDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(CreateDisciplineSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid discipline incident',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const row = await service.addDiscipline(
          tenantId,
          params.data.id,
          body.data,
          actorOf(request),
        );
        return reply.status(201).send(formatDiscipline(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    `${prefix}/:id/discipline/:incidentId`,
    async (
      request: FastifyRequest<{ Params: { id: string; incidentId: string } }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, { id: request.params.id });
      const incident = validate(StudentParamsSchema, { id: request.params.incidentId });
      if (!params.success || !incident.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid id',
          statusCode: 400,
        });
      }
      try {
        await service.removeDiscipline(tenantId, params.data.id, incident.data.id);
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/attendance-heatmap`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: HeatmapQueryDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const query = validate(HeatmapQuerySchema, request.query ?? {});
      if (!query.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid heatmap range',
          statusCode: 400,
          errors: query.errors,
        });
      }
      try {
        const heatmap = await service.attendanceHeatmap(
          tenantId,
          params.data.id,
          query.data.from,
          query.data.to,
        );
        return reply.status(200).send(heatmap);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // --- W2-SIS-03 student document registry ---------------------------------

  fastify.post(
    `${prefix}/:id/documents`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UploadDocumentDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(UploadDocumentSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid document payload',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const doc = await service.uploadDocument(
          tenantId,
          params.data.id,
          body.data,
          actorOf(request),
        );
        return reply.status(201).send(formatDocument(doc));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/documents`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const docs = await service.listDocuments(tenantId, params.data.id);
        return reply.status(200).send(docs.map(formatDocument));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/documents/:docId`,
    async (
      request: FastifyRequest<{ Params: DocumentParamsDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(DocumentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid document path',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const { bytes, mimeType, fileName, signedUrl } = await service.getDocumentBytes(
          tenantId,
          params.data.id,
          params.data.docId,
        );
        if (signedUrl) {
          return reply.status(200).send({ url: signedUrl, mimeType, fileName });
        }
        return reply
          .status(200)
          .header('content-type', mimeType)
          .header('content-disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`)
          .header('cache-control', 'private, no-store')
          .send(bytes);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    `${prefix}/:id/documents/:docId`,
    async (
      request: FastifyRequest<{ Params: DocumentParamsDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(DocumentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid document path',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        await service.removeDocument(tenantId, params.data.id, params.data.docId);
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
