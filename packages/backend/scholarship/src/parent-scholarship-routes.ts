/**
 * Parent-portal scholarship routes.
 *
 * Mounted at /parent-portal/scholarships so gateway RBAC uses the parent
 * resource (parents do not hold scholarship.read). Every application row is
 * limited to the caller's linked children.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { deriveApplicantAttributes, type ApplicantAttributesLookup } from './application-intake.js';
import { actorFromRequest, assertCanReadDocuments } from './document-access.js';
import {
  createScholarshipDocumentBlobStore,
  type ScholarshipDocumentBlobStore,
} from './document-blob-store.js';
import type { DownloadTokenReplayStore } from './document-bytes.js';
import {
  authorizeApplicationCreate,
  registerScholarshipDocumentRoutes,
} from './document-routes.js';
import { ScholarshipDocumentService } from './document-service.js';
import {
  InMemoryScholarshipDocumentStore,
  type ScholarshipDocumentStore,
} from './document-store.js';
import {
  applicantAttributesForStudent,
  institutionIdForStudent,
  linkLookupUnavailable,
} from './parent-links.js';
import { CreateApplicationSchema } from './schemas.js';
import type { ScholarshipRepository } from './scholarship-repository.js';
import { ScholarshipService } from './scholarship-service.js';

export interface ParentScholarshipRouteOptions {
  scholarshipService: ScholarshipService;
  documentService: ScholarshipDocumentService;
  prefix?: string;
  resolveLinkedStudentIds?: (tenantId: string, userId: string) => Promise<string[]>;
  /** Server-side institution of record for a student (PRC-L345). */
  resolveStudentInstitutionId?: (tenantId: string, studentId: string) => Promise<string | null>;
  /** PRC-L345: student-record lookup for areaId/gender (defaults to Postgres). */
  resolveApplicantAttributes?: ApplicantAttributesLookup;
  /** PRC-L344: shared single-use store for document download links. */
  downloadReplayGuard?: DownloadTokenReplayStore;
}

async function actorFor(
  request: FastifyRequest,
  tenantId: string,
  resolve?: ParentScholarshipRouteOptions['resolveLinkedStudentIds'],
) {
  let actor = actorFromRequest(request);
  if (resolve && actor.userId) {
    try {
      actor = actorFromRequest(request, await resolve(tenantId, actor.userId));
    } catch (error) {
      // PRC-L346: do not silently fall back to "no children"; report the outage.
      request.log.error(
        { err: error, event: 'scholarship.parent_links.lookup_failed' },
        'guardian link lookup failed',
      );
      throw linkLookupUnavailable('Guardian link lookup is unavailable', error);
    }
  }
  return actor;
}

// PRC-L346: any RFC 9562 UUID (v1-v8), not only v4.
const APPLICANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function sendAppError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
  throw error;
}
function positiveInt(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function ownedIds(actor: ReturnType<typeof actorFromRequest>): string[] {
  return [
    ...new Set(
      [actor.userId, actor.studentId, ...actor.linkedStudentIds].filter(
        (id): id is string => typeof id === 'string' && APPLICANT_UUID.test(id),
      ),
    ),
  ];
}

export async function registerParentScholarshipRoutes(
  fastify: FastifyInstance,
  options: ParentScholarshipRouteOptions,
): Promise<void> {
  const { scholarshipService, documentService, resolveLinkedStudentIds } = options;
  const resolveStudentInstitutionId =
    options.resolveStudentInstitutionId ?? institutionIdForStudent;
  const resolveApplicantAttributes =
    options.resolveApplicantAttributes ?? applicantAttributesForStudent;
  const prefix = options.prefix ?? '';

  fastify.get(`${prefix}/programs`, async (request, reply) => {
    const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
    if (!tenantId) {
      return reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
    }
    const result = await scholarshipService.listPrograms(
      tenantId,
      { status: 'open' },
      { page: 1, pageSize: 50, sortBy: 'name', sortOrder: 'asc' },
    );
    return reply.send({
      data: result.data.map((program) => ({
        id: program.id,
        name: program.name,
        status: program.status,
        applicationStartDate: program.applicationStartDate,
        applicationEndDate: program.applicationEndDate,
        amountPerRecipient: program.amountPerRecipient,
        currency: program.currency,
        eligibility: { requiredDocuments: program.eligibility.requiredDocuments ?? [] },
      })),
    });
  });

  fastify.get(`${prefix}/applications`, async (request, reply) => {
    const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
    if (!tenantId) {
      return reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
    }
    let actor;
    try {
      actor = await actorFor(request, tenantId, resolveLinkedStudentIds);
    } catch (error) {
      return sendAppError(reply, error);
    }
    const ids = ownedIds(actor);
    const query = (request.query ?? {}) as { page?: string; pageSize?: string };
    const page = positiveInt(query.page, 1, 10_000);
    const pageSize = positiveInt(query.pageSize, 50, 100);
    if (ids.length === 0) {
      return reply.send({
        data: [],
        meta: { page, pageSize, totalItems: 0, totalPages: 0 },
      });
    }
    // PRC-L346: one query across all owned applicants with real pagination.
    const result = await scholarshipService.listApplications(
      tenantId,
      { applicantIds: ids },
      { page, pageSize, sortBy: 'createdAt', sortOrder: 'desc' },
    );
    return reply.send({
      data: result.data.map((application) => ({
        id: application.id,
        programId: application.programId,
        applicantId: application.applicantId,
        status: application.status,
        submittedAt: application.submittedAt.toISOString(),
      })),
      meta: result.meta,
    });
  });
  fastify.get(`${prefix}/applications/:id`, async (request, reply) => {
    const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
    if (!tenantId) {
      return reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
    }
    const id = (request.params as { id: string }).id;
    try {
      const application = await scholarshipService.getApplicationById(tenantId, id);
      const actor = await actorFor(request, tenantId, resolveLinkedStudentIds);
      assertCanReadDocuments(actor, application);
      return reply.send({
        id: application.id,
        programId: application.programId,
        applicantId: application.applicantId,
        institutionId: application.institutionId,
        status: application.status,
      });
    } catch (error) {
      if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
      throw error;
    }
  });

  fastify.post(`${prefix}/applications`, async (request, reply) => {
    const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
    if (!tenantId) {
      return reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
    }
    const raw = (request.body ?? {}) as Record<string, unknown>;
    if (typeof raw.applicantId === 'string') {
      // PRC-L345: the institution comes from the student's enrolment, not the client.
      let recorded: string | null;
      try {
        recorded = await resolveStudentInstitutionId(tenantId, raw.applicantId);
      } catch (error) {
        return sendAppError(reply, error);
      }
      if (recorded) {
        if (typeof raw.institutionId === 'string' && raw.institutionId !== recorded) {
          return reply.status(422).send({
            code: 'INSTITUTION_MISMATCH',
            message: "institutionId does not match the student's current enrolment",
            statusCode: 422,
          });
        }
        raw.institutionId = recorded;
      }
    }
    const parsed = validate(CreateApplicationSchema, { ...raw, asDraft: true });
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    if (
      !(await authorizeApplicationCreate(
        request,
        reply,
        parsed.data.applicantId,
        resolveLinkedStudentIds,
      ))
    ) {
      return;
    }
    let attributes: { areaId?: string; gender?: 'male' | 'female' | 'other' };
    try {
      // PRC-L345: areaId/gender from the student record; contradictions are a 422.
      attributes = await deriveApplicantAttributes({
        tenantId,
        applicantId: parsed.data.applicantId,
        claimed: { areaId: parsed.data.areaId, gender: parsed.data.gender },
        lookup: resolveApplicantAttributes,
      });
    } catch (error) {
      return sendAppError(reply, error);
    }
    const { areaId: _claimedArea, gender: _claimedGender, ...claimedRest } = parsed.data;
    void _claimedArea;
    void _claimedGender;
    try {
      const application = await scholarshipService.submitApplication(tenantId, {
        ...claimedRest,
        ...attributes,
        asDraft: true,
      });
      return reply.status(201).send({
        id: application.id,
        status: application.status,
        applicantId: application.applicantId,
      });
    } catch (error) {
      if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
      throw error;
    }
  });

  await registerScholarshipDocumentRoutes(fastify, {
    scholarshipService,
    documentService,
    prefix,
    resolveLinkedStudentIds,
    downloadReplayGuard: options.downloadReplayGuard,
  });
}

export interface ParentScholarshipPluginOptions {
  repository: ScholarshipRepository;
  prefix?: string;
  documentStore?: ScholarshipDocumentStore;
  documentBlobs?: ScholarshipDocumentBlobStore;
  resolveLinkedStudentIds?: (tenantId: string, userId: string) => Promise<string[]>;
  /** Server-side institution of record for a student (PRC-L345). */
  resolveStudentInstitutionId?: (tenantId: string, studentId: string) => Promise<string | null>;
  /** PRC-L345: student-record lookup for areaId/gender (defaults to Postgres). */
  resolveApplicantAttributes?: ApplicantAttributesLookup;
  /** PRC-L344: shared single-use store for document download links. */
  downloadReplayGuard?: DownloadTokenReplayStore;
}

export const parentScholarshipPlugin = fp(
  async function parentScholarshipPluginImpl(
    fastify: FastifyInstance,
    options: ParentScholarshipPluginOptions,
  ) {
    const scholarshipService = new ScholarshipService(options.repository);
    const documentService = new ScholarshipDocumentService({
      documents: options.documentStore ?? new InMemoryScholarshipDocumentStore(),
      blobs: options.documentBlobs ?? createScholarshipDocumentBlobStore(),
      scholarshipService,
    });
    await registerParentScholarshipRoutes(fastify, {
      scholarshipService,
      documentService,
      prefix: options.prefix ?? '',
      resolveLinkedStudentIds: options.resolveLinkedStudentIds,
      resolveStudentInstitutionId: options.resolveStudentInstitutionId,
      resolveApplicantAttributes: options.resolveApplicantAttributes,
      downloadReplayGuard: options.downloadReplayGuard,
    });
  },
  { name: '@proctira/backend-scholarship-parent', fastify: '5.x' },
);
