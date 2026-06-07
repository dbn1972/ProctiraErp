/**
 * Assessment Routes
 *
 * Grading Schemes:
 *   POST   /grading-schemes       - Create a new grading scheme
 *   GET    /grading-schemes       - List grading schemes (paginated)
 *   GET    /grading-schemes/:id   - Get a single grading scheme
 *   PUT    /grading-schemes/:id   - Update a grading scheme
 *   DELETE /grading-schemes/:id   - Delete a grading scheme
 *
 * Assessment Items:
 *   POST   /assessment-items      - Define assessment items for a subject+period
 *   GET    /assessment-items      - Get assessment items for a subject+period
 *
 * Outcomes:
 *   POST   /outcomes              - Create a curriculum outcome
 *   GET    /outcomes              - Get outcomes for a subject
 *   DELETE /outcomes/:id          - Delete an outcome
 *
 * Requirements: 8.1, 8.2, 8.3, 8.6
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { AssessmentService } from './assessment-service.js';
import {
  CreateGradingSchemeSchema,
  UpdateGradingSchemeSchema,
  GradingSchemeParamsSchema,
  GradingSchemeListQuerySchema,
  DefineAssessmentItemsSchema,
  AssessmentItemsQuerySchema,
  CreateOutcomeSchema,
  OutcomeParamsSchema,
  type CreateGradingSchemeInput,
  type UpdateGradingSchemeInput,
  type GradingSchemeParams,
  type GradingSchemeListQuery,
  type DefineAssessmentItemsInput,
  type AssessmentItemsQuery,
  type CreateOutcomeInput,
  type OutcomeParams,
} from './schemas.js';

/**
 * Options for registering assessment routes.
 */
export interface AssessmentRoutesOptions {
  assessmentService: AssessmentService;
  /** Route prefix for grading schemes (default: '/grading-schemes') */
  gradingSchemesPrefix?: string;
  /** Route prefix for assessment items (default: '/assessment-items') */
  assessmentItemsPrefix?: string;
  /** Route prefix for outcomes (default: '/outcomes') */
  outcomesPrefix?: string;
}

/**
 * Extract tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/**
 * Format a grading scheme entity to API response.
 */
function formatGradingSchemeResponse(entity: {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  minValue: number;
  maxValue: number;
  thresholds: Array<{ grade: string; minScore: number; maxScore: number; descriptor?: string }>;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    type: entity.type,
    minValue: entity.minValue,
    maxValue: entity.maxValue,
    thresholds: entity.thresholds,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format an assessment item entity to API response.
 */
function formatAssessmentItemResponse(entity: {
  id: string;
  subjectId: string;
  academicPeriodId: string;
  gradingSchemeId: string;
  name: string;
  weight: number;
  maxScore: number;
  minScore: number;
  outcomeIds: string[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    subjectId: entity.subjectId,
    academicPeriodId: entity.academicPeriodId,
    gradingSchemeId: entity.gradingSchemeId,
    name: entity.name,
    weight: entity.weight,
    maxScore: entity.maxScore,
    minScore: entity.minScore,
    outcomeIds: entity.outcomeIds,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format an outcome entity to API response.
 */
function formatOutcomeResponse(entity: {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  subjectId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    code: entity.code,
    description: entity.description,
    subjectId: entity.subjectId,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register all assessment routes on a Fastify instance.
 */
export async function registerAssessmentRoutes(
  fastify: FastifyInstance,
  options: AssessmentRoutesOptions,
): Promise<void> {
  const {
    assessmentService,
    gradingSchemesPrefix = '/grading-schemes',
    assessmentItemsPrefix = '/assessment-items',
    outcomesPrefix = '/outcomes',
  } = options;

  // ─── Grading Scheme Routes ─────────────────────────────────────────────

  /**
   * POST /grading-schemes
   * Create a new grading scheme.
   */
  fastify.post(
    gradingSchemesPrefix,
    async function createGradingSchemeHandler(
      request: FastifyRequest<{ Body: CreateGradingSchemeInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateGradingSchemeSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const scheme = await assessmentService.createGradingScheme(tenantId, result.data);
        return reply.status(201).send(formatGradingSchemeResponse(scheme));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /grading-schemes
   * List grading schemes with pagination.
   */
  fastify.get(
    gradingSchemesPrefix,
    async function listGradingSchemesHandler(
      request: FastifyRequest<{ Querystring: GradingSchemeListQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const query = { ...request.query } as GradingSchemeListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await assessmentService.listGradingSchemes(
        tenantId,
        { type: query.type, search: query.search },
        { page, pageSize },
      );

      return reply.status(200).send({
        data: result.data.map(formatGradingSchemeResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /grading-schemes/:id
   * Get a single grading scheme.
   */
  fastify.get(
    `${gradingSchemesPrefix}/:id`,
    async function getGradingSchemeHandler(
      request: FastifyRequest<{ Params: GradingSchemeParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(GradingSchemeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid grading scheme ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const scheme = await assessmentService.getGradingScheme(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatGradingSchemeResponse(scheme));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /grading-schemes/:id
   * Update a grading scheme.
   */
  fastify.put(
    `${gradingSchemesPrefix}/:id`,
    async function updateGradingSchemeHandler(
      request: FastifyRequest<{ Params: GradingSchemeParams; Body: UpdateGradingSchemeInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(GradingSchemeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid grading scheme ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateGradingSchemeSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const scheme = await assessmentService.updateGradingScheme(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatGradingSchemeResponse(scheme));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /grading-schemes/:id
   * Delete a grading scheme.
   */
  fastify.delete(
    `${gradingSchemesPrefix}/:id`,
    async function deleteGradingSchemeHandler(
      request: FastifyRequest<{ Params: GradingSchemeParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(GradingSchemeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid grading scheme ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        await assessmentService.deleteGradingScheme(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Assessment Item Routes ────────────────────────────────────────────

  /**
   * POST /assessment-items
   * Define assessment items for a subject in an academic period.
   * Replaces any existing items for the subject+period combination.
   */
  fastify.post(
    assessmentItemsPrefix,
    async function defineAssessmentItemsHandler(
      request: FastifyRequest<{ Body: DefineAssessmentItemsInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(DefineAssessmentItemsSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const items = await assessmentService.defineAssessmentItems(tenantId, result.data);
        const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
        return reply.status(201).send({
          subjectId: result.data.subjectId,
          academicPeriodId: result.data.academicPeriodId,
          gradingSchemeId: result.data.gradingSchemeId,
          totalWeight: Math.round(totalWeight * 100) / 100,
          items: items.map(formatAssessmentItemResponse),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /assessment-items?subjectId=...&academicPeriodId=...
   * Get assessment items for a subject in an academic period.
   */
  fastify.get(
    assessmentItemsPrefix,
    async function getAssessmentItemsHandler(
      request: FastifyRequest<{ Querystring: AssessmentItemsQuery }>,
      reply: FastifyReply,
    ) {
      // Convert query to plain object to avoid Typebox clone issues with Fastify query objects
      const queryData = { ...request.query } as Record<string, unknown>;
      const result = validate(AssessmentItemsQuerySchema, queryData);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const items = await assessmentService.getAssessmentItems(
        tenantId,
        result.data.subjectId,
        result.data.academicPeriodId,
      );

      const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
      const gradingSchemeId = items.length > 0 ? items[0]!.gradingSchemeId : null;

      return reply.status(200).send({
        subjectId: result.data.subjectId,
        academicPeriodId: result.data.academicPeriodId,
        gradingSchemeId,
        totalWeight: Math.round(totalWeight * 100) / 100,
        items: items.map(formatAssessmentItemResponse),
      });
    },
  );

  // ─── Outcome Routes ────────────────────────────────────────────────────

  /**
   * POST /outcomes
   * Create a curriculum outcome.
   */
  fastify.post(
    outcomesPrefix,
    async function createOutcomeHandler(
      request: FastifyRequest<{ Body: CreateOutcomeInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateOutcomeSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const outcome = await assessmentService.createOutcome(tenantId, result.data);
        return reply.status(201).send(formatOutcomeResponse(outcome));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /outcomes?subjectId=...
   * Get outcomes for a subject.
   */
  fastify.get(
    outcomesPrefix,
    async function getOutcomesHandler(
      request: FastifyRequest<{ Querystring: { subjectId: string } }>,
      reply: FastifyReply,
    ) {
      const queryData = { ...request.query } as Record<string, unknown>;
      const subjectId = queryData.subjectId as string | undefined;
      if (!subjectId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'subjectId query parameter is required',
          statusCode: 400,
          errors: [{ field: 'subjectId', rule: 'required', message: 'subjectId is required' }],
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const outcomes = await assessmentService.getOutcomesBySubject(tenantId, subjectId);
      return reply.status(200).send({
        data: outcomes.map(formatOutcomeResponse),
      });
    },
  );

  /**
   * DELETE /outcomes/:id
   * Delete a curriculum outcome.
   */
  fastify.delete(
    `${outcomesPrefix}/:id`,
    async function deleteOutcomeHandler(
      request: FastifyRequest<{ Params: OutcomeParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(OutcomeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid outcome ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        await assessmentService.deleteOutcome(tenantId, paramsResult.data.id);
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
