/**
 * Parent-portal scholarship routes.
 *
 * Mounted at /parent-portal/scholarships so gateway RBAC uses the parent
 * resource (parents do not hold scholarship.read). Every application row is
 * limited to the caller's linked children.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { actorFromRequest, assertCanReadDocuments } from './document-access.js';
import {
  createScholarshipDocumentBlobStore,
  type ScholarshipDocumentBlobStore,
} from './document-blob-store.js';
import {
  authorizeApplicationCreate,
  registerScholarshipDocumentRoutes,
} from './document-routes.js';
import { ScholarshipDocumentService } from './document-service.js';
import {
  InMemoryScholarshipDocumentStore,
  type ScholarshipDocumentStore,
} from './document-store.js';
import { institutionIdForStudent } from './parent-links.js';
import { CreateApplicationSchema } from './schemas.js';
import type { ScholarshipRepository } from './scholarship-repository.js';
import { ScholarshipService } from './scholarship-service.js';

export interface ParentScholarshipRouteOptions {
  scholarshipService: ScholarshipService;
  documentService: ScholarshipDocumentService;
  prefix?: string;
  resolveLinkedStudentIds?: (tenantId: string, userId: string) => Promise<string[]>;
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
    } catch {
      // JWT linkedStudentIds still apply.
    }
  }
  return actor;
}

const APPLICANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const actor = await actorFor(request, tenantId, resolveLinkedStudentIds);
    const ids = ownedIds(actor);
    const rows = [];
    for (const applicantId of ids) {
      const page = await scholarshipService.listApplications(
        tenantId,
        { applicantId },
        { page: 1, pageSize: 50, sortBy: 'createdAt', sortOrder: 'desc' },
      );
      rows.push(...page.data);
    }
    return reply.send({
      data: rows.map((application) => ({
        id: application.id,
        programId: application.programId,
        applicantId: application.applicantId,
        status: application.status,
        submittedAt: application.submittedAt.toISOString(),
      })),
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
    if (typeof raw.applicantId === 'string' && typeof raw.institutionId !== 'string') {
      raw.institutionId = (await institutionIdForStudent(tenantId, raw.applicantId)) ?? undefined;
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
    try {
      const application = await scholarshipService.submitApplication(tenantId, {
        ...parsed.data,
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
  });
}

export interface ParentScholarshipPluginOptions {
  repository: ScholarshipRepository;
  prefix?: string;
  documentStore?: ScholarshipDocumentStore;
  documentBlobs?: ScholarshipDocumentBlobStore;
  resolveLinkedStudentIds?: (tenantId: string, userId: string) => Promise<string[]>;
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
    });
  },
  { name: '@proctira/backend-scholarship-parent', fastify: '5.x' },
);
