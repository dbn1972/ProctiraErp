/**
 * Examination Routes
 *
 * POST   /examinations       - Create a new examination
 * PUT    /examinations/:id   - Update an examination
 * DELETE /examinations/:id   - Delete an examination
 * GET    /examinations       - List examinations (paginated, filterable)
 * GET    /examinations/:id   - Get a single examination
 *
 * Requirements:
 * - 10.1: Examination CRUD with subjects, centers, sessions, scheduling
 * - 10.7: 1–10 grading schemes per examination
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { ExaminationService } from './examination-service.js';
import type { ExaminationEntity } from './examination-repository.js';
import {
  CreateExaminationSchema,
  UpdateExaminationSchema,
  ExaminationParamsSchema,
  RegisterCandidateSchema,
  type CreateExaminationInput,
  type UpdateExaminationInput,
  type ExaminationListQuery,
  type ExaminationParams,
  type RegisterCandidateInput,
} from './schemas.js';

/**
 * Options for registering examination routes.
 */
export interface ExaminationRoutesOptions {
  examinationService: ExaminationService;
  /** Route prefix (default: '/examinations') */
  prefix?: string;
}

/**
 * Formats an examination entity to the API response shape.
 */
function formatExaminationResponse(entity: ExaminationEntity) {
  return {
    id: entity.id,
    name: entity.name,
    code: entity.code,
    description: entity.description,
    academicPeriodId: entity.academicPeriodId,
    startDate: entity.startDate,
    endDate: entity.endDate,
    status: entity.status,
    subjects: entity.subjects.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      maxScore: s.maxScore,
      gradingSchemeId: s.gradingSchemeId,
    })),
    centers: entity.centers.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      institutionId: c.institutionId,
      capacity: c.capacity,
    })),
    sessions: entity.sessions.map((s) => ({
      id: s.id,
      subjectId: s.subjectId,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      centerId: s.centerId,
    })),
    gradingSchemes: entity.gradingSchemes.map((gs) => ({
      id: gs.id,
      name: gs.name,
      minScore: gs.minScore,
      maxScore: gs.maxScore,
      passThreshold: gs.passThreshold,
      thresholds: gs.thresholds,
    })),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register examination routes on a Fastify instance.
 */
export async function registerExaminationRoutes(
  fastify: FastifyInstance,
  options: ExaminationRoutesOptions,
): Promise<void> {
  const { examinationService, prefix = '/examinations' } = options;

  /**
   * POST /examinations
   * Create a new examination.
   */
  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateExaminationInput }>,
      reply: FastifyReply,
    ) {
      // Validate request body
      const result = validate(CreateExaminationSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const examination = await examinationService.create(tenantId, result.data);
        return reply.status(201).send(formatExaminationResponse(examination));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /examinations/:id
   * Update an existing examination.
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: ExaminationParams; Body: UpdateExaminationInput }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(ExaminationParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      // Validate body
      const bodyResult = validate(UpdateExaminationSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const examination = await examinationService.update(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatExaminationResponse(examination));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /examinations/:id
   * Delete an examination.
   */
  fastify.delete(
    `${prefix}/:id`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: ExaminationParams }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(ExaminationParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        await examinationService.delete(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /examinations
   * List examinations with pagination and filtering.
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: ExaminationListQuery }>,
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

      const query = request.query as ExaminationListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'name';
      const sortOrder = (query.sortOrder ?? 'asc') as 'asc' | 'desc';

      const result = await examinationService.list(
        tenantId,
        {
          academicPeriodId: query.academicPeriodId,
          status: query.status as ExaminationEntity['status'] | undefined,
          search: query.search,
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map(formatExaminationResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /examinations/:id
   * Get a single examination by ID.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: ExaminationParams }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(ExaminationParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const examination = await examinationService.getById(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatExaminationResponse(examination));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /examinations/:id/candidates
   * Register a candidate for an examination with eligibility validation.
   *
   * Requirements:
   * - 10.2: Validate eligibility (active enrollment + prerequisite subjects)
   * - 10.3: Reject ineligible candidates with error indicating which conditions failed
   */
  fastify.post(
    `${prefix}/:id/candidates`,
    async function registerCandidateHandler(
      request: FastifyRequest<{ Params: ExaminationParams; Body: RegisterCandidateInput }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(ExaminationParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      // Validate body
      const bodyResult = validate(RegisterCandidateSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const registration = await examinationService.registerCandidate(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(201).send({
          id: registration.id,
          examinationId: registration.examinationId,
          studentId: registration.studentId,
          centerId: registration.centerId,
          subjectIds: registration.subjectIds,
          status: registration.status,
          registeredAt: registration.registeredAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
