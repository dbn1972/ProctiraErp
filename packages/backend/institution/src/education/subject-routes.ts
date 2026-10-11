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
import { AppError } from '@proctira/common';
import { Type, validate, validateQuery } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  CreateSubjectSchema,
  UpdateSubjectSchema,
  LinkSubjectToGradeSchema,
} from './subject-schemas.js';
import type {
  CreateSubjectDto,
  UpdateSubjectDto,
  LinkSubjectToGradeDto,
} from './subject-schemas.js';
import type { SubjectService } from './subject-service.js';

export interface SubjectRoutesOptions {
  service: SubjectService;
  subjectPrefix?: string;
  institutionSubjectPrefix?: string;
}

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });
const InstitutionSubjectListQuerySchema = Type.Object({
  institutionId: Type.String({ format: 'uuid' }),
  gradeId: Type.Optional(Type.String({ format: 'uuid' })),
});

function validationError(reply: FastifyReply, message: string, errors: unknown) {
  return reply.status(400).send({
    code: 'VALIDATION_ERROR',
    message,
    statusCode: 400,
    errors,
  });
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
    createdAt: subject.createdAt.toISOString(),
    updatedAt: subject.updatedAt.toISOString(),
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
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
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

  function getTenantId(request: FastifyRequest, reply: FastifyReply): string | undefined {
    const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
    if (!tenantId) {
      void reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
      return undefined;
    }
    return tenantId;
  }

  // ─── Subject CRUD ──────────────────────────────────────────────────────────

  fastify.post(
    subjectPrefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateSubjectDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const body = validate(CreateSubjectSchema, request.body);
      if (!body.success) return validationError(reply, 'Validation failed', body.errors);

      try {
        const subject = await service.create(tenantId, body.data);
        return reply.status(201).send(formatSubjectResponse(subject));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    subjectPrefix,
    async function listHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

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
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const params = validate(IdParamsSchema, request.params);
      if (!params.success) return validationError(reply, 'Invalid subject ID', params.errors);

      try {
        const subject = await service.getById(tenantId, params.data.id);
        return reply.status(200).send(formatSubjectResponse(subject));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.put(
    `${subjectPrefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateSubjectDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const params = validate(IdParamsSchema, request.params);
      if (!params.success) return validationError(reply, 'Invalid subject ID', params.errors);

      const body = validate(UpdateSubjectSchema, request.body);
      if (!body.success) return validationError(reply, 'Validation failed', body.errors);

      try {
        const subject = await service.update(tenantId, params.data.id, body.data);
        return reply.status(200).send(formatSubjectResponse(subject));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.delete(
    `${subjectPrefix}/:id`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const params = validate(IdParamsSchema, request.params);
      if (!params.success) return validationError(reply, 'Invalid subject ID', params.errors);

      try {
        await service.delete(tenantId, params.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── InstitutionSubject (Subject-to-Grade Linking) ─────────────────────────

  fastify.post(
    institutionSubjectPrefix,
    async function linkHandler(
      request: FastifyRequest<{ Body: LinkSubjectToGradeDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const body = validate(LinkSubjectToGradeSchema, request.body);
      if (!body.success) return validationError(reply, 'Validation failed', body.errors);

      try {
        const link = await service.linkToGrade(tenantId, body.data);
        return reply.status(201).send(formatInstitutionSubjectResponse(link));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
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
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const query = validateQuery(InstitutionSubjectListQuerySchema, request.query);
      if (!query.success) return validationError(reply, 'Invalid query parameters', query.errors);

      const { institutionId, gradeId } = query.data;
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
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const params = validate(IdParamsSchema, request.params);
      if (!params.success) return validationError(reply, 'Invalid link ID', params.errors);

      try {
        await service.unlinkFromGrade(tenantId, params.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
