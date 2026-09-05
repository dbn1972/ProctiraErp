/**
 * Subject Routes
 *
 * POST   /subjects                      - Create a new subject
 * GET    /subjects                      - List all subjects
 * GET    /subjects/:id                  - Get subject by ID
 * PUT    /subjects/:id                  - Update a subject
 * DELETE /subjects/:id                  - Soft-delete a subject
 * POST   /institution-subjects          - Link a subject to a grade in an institution
 * GET    /institution-subjects          - List subject-grade links (filter by institutionId, gradeId)
 * DELETE /institution-subjects/:id      - Remove a subject-grade link
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { SubjectService } from './subject-service.js';
import { toIsoString } from '../date-utils.js';
import type {
  CreateSubjectDto,
  UpdateSubjectDto,
  LinkSubjectToGradeDto,
} from './subject-schemas.js';

export interface SubjectRoutesOptions {
  service: SubjectService;
  subjectPrefix?: string;
  institutionSubjectPrefix?: string;
}

function formatSubjectResponse(subject: {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: subject.id,
    tenantId: subject.tenantId,
    name: subject.name,
    code: subject.code,
    createdAt: toIsoString(subject.createdAt),
    updatedAt: toIsoString(subject.updatedAt),
  };
}

function formatInstitutionSubjectResponse(link: {
  id: string;
  tenantId: string;
  institutionId: string;
  subjectId: string;
  gradeId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: link.id,
    tenantId: link.tenantId,
    institutionId: link.institutionId,
    subjectId: link.subjectId,
    gradeId: link.gradeId,
    createdAt: toIsoString(link.createdAt),
    updatedAt: toIsoString(link.updatedAt),
  };
}

export async function registerSubjectRoutes(
  fastify: FastifyInstance,
  options: SubjectRoutesOptions,
): Promise<void> {
  const {
    service,
    subjectPrefix = '/subjects',
    institutionSubjectPrefix = '/institution-subjects',
  } = options;

  // ─── Subject CRUD ──────────────────────────────────────────────────────────

  fastify.post(
    subjectPrefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateSubjectDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const subject = await service.create(tenantId, request.body);
      return reply.status(201).send(formatSubjectResponse(subject));
    },
  );

  fastify.get(
    subjectPrefix,
    async function listHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const subjects = await service.list(tenantId);
      return reply.status(200).send(subjects.map(formatSubjectResponse));
    },
  );

  fastify.get(
    `${subjectPrefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const subject = await service.getById(tenantId, request.params.id);
      return reply.status(200).send(formatSubjectResponse(subject));
    },
  );

  fastify.put(
    `${subjectPrefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateSubjectDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const subject = await service.update(tenantId, request.params.id, request.body);
      return reply.status(200).send(formatSubjectResponse(subject));
    },
  );

  fastify.delete(
    `${subjectPrefix}/:id`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      await service.delete(tenantId, request.params.id);
      return reply.status(204).send();
    },
  );

  // ─── InstitutionSubject (Subject-to-Grade Linking) ─────────────────────────

  fastify.post(
    institutionSubjectPrefix,
    async function linkHandler(
      request: FastifyRequest<{ Body: LinkSubjectToGradeDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const link = await service.linkToGrade(tenantId, request.body);
      return reply.status(201).send(formatInstitutionSubjectResponse(link));
    },
  );

  fastify.get(
    institutionSubjectPrefix,
    async function listLinksHandler(
      request: FastifyRequest<{
        Querystring: { institutionId: string; gradeId?: string };
      }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const { institutionId, gradeId } = request.query;
      if (!institutionId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'institutionId query parameter is required',
          statusCode: 400,
        });
      }

      const links = await service.listInstitutionSubjects(tenantId, institutionId, { gradeId });
      return reply.status(200).send(links.map(formatInstitutionSubjectResponse));
    },
  );

  fastify.delete(
    `${institutionSubjectPrefix}/:id`,
    async function unlinkHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      await service.unlinkFromGrade(tenantId, request.params.id);
      return reply.status(204).send();
    },
  );
}
