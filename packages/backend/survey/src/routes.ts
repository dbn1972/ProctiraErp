/**
 * Survey Routes
 *
 * Surveys:
 *   POST   /surveys              - Create a new survey
 *   GET    /surveys              - List surveys (paginated)
 *   GET    /surveys/:id          - Get a single survey
 *   PUT    /surveys/:id          - Update a survey
 *   DELETE /surveys/:id          - Delete a survey
 *
 * Distribution:
 *   POST   /surveys/distribute   - Distribute survey to institutions
 *   GET    /surveys/:id/status   - Get completion status
 *   POST   /surveys/:id/remind   - Send reminders
 *
 * Submissions:
 *   POST   /surveys/submit       - Submit survey responses
 *
 * Aggregation:
 *   GET    /surveys/:id/aggregate - Get aggregated responses
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { SurveyService } from './survey-service.js';
import {
  CreateSurveySchema,
  UpdateSurveySchema,
  SurveyParamsSchema,
  SurveyListQuerySchema,
  DistributeSurveySchema,
  SubmitSurveySchema,
  SendReminderSchema,
  AggregateResponsesQuerySchema,
  type CreateSurveyInput,
  type UpdateSurveyInput,
  type SurveyParams,
  type SurveyListQuery,
  type DistributeSurveyInput,
  type SubmitSurveyInput,
} from './schemas.js';

/**
 * Options for registering survey routes.
 */
export interface SurveyRoutesOptions {
  surveyService: SurveyService;
  /** Route prefix for surveys (default: '/surveys') */
  prefix?: string;
}

/**
 * Extract tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/**
 * Format a survey entity to API response.
 */
function formatSurveyResponse(entity: {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  academicPeriodId: string | null;
  startDate: string | null;
  endDate: string | null;
  questions: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    order: number;
    options?: unknown;
    columns?: unknown;
    repeaterFields?: unknown;
    validation?: unknown;
  }>;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    description: entity.description,
    status: entity.status,
    academicPeriodId: entity.academicPeriodId,
    startDate: entity.startDate,
    endDate: entity.endDate,
    questions: entity.questions,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register all survey routes on a Fastify instance.
 */
export async function registerSurveyRoutes(
  fastify: FastifyInstance,
  options: SurveyRoutesOptions,
): Promise<void> {
  const { surveyService, prefix = '/surveys' } = options;

  // ─── Survey CRUD Routes ──────────────────────────────────────────────

  /**
   * POST /surveys
   * Create a new survey.
   */
  fastify.post(
    prefix,
    async function createSurveyHandler(
      request: FastifyRequest<{ Body: CreateSurveyInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateSurveySchema, request.body);
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
        const survey = await surveyService.createSurvey(tenantId, result.data);
        return reply.status(201).send(formatSurveyResponse(survey));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /surveys
   * List surveys with pagination.
   */
  fastify.get(
    prefix,
    async function listSurveysHandler(
      request: FastifyRequest<{ Querystring: SurveyListQuery }>,
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

      const query = { ...request.query } as SurveyListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await surveyService.listSurveys(
        tenantId,
        { status: query.status, search: query.search },
        { page, pageSize },
      );

      return reply.status(200).send({
        data: result.data.map(formatSurveyResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /surveys/:id
   * Get a single survey.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getSurveyHandler(
      request: FastifyRequest<{ Params: SurveyParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SurveyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid survey ID',
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
        const survey = await surveyService.getSurvey(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatSurveyResponse(survey));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /surveys/:id
   * Update a survey.
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateSurveyHandler(
      request: FastifyRequest<{ Params: SurveyParams; Body: UpdateSurveyInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SurveyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid survey ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateSurveySchema, request.body);
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
        const survey = await surveyService.updateSurvey(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatSurveyResponse(survey));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /surveys/:id
   * Delete a survey.
   */
  fastify.delete(
    `${prefix}/:id`,
    async function deleteSurveyHandler(
      request: FastifyRequest<{ Params: SurveyParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SurveyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid survey ID',
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
        await surveyService.deleteSurvey(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Distribution Routes ─────────────────────────────────────────────

  /**
   * POST /surveys/distribute
   * Distribute a survey to institutions based on filters.
   */
  fastify.post(
    `${prefix}/distribute`,
    async function distributeSurveyHandler(
      request: FastifyRequest<{ Body: DistributeSurveyInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(DistributeSurveySchema, request.body);
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
        const records = await surveyService.distributeSurvey(tenantId, result.data);
        return reply.status(201).send({
          distributed: records.length,
          records: records.map((r) => ({
            id: r.id,
            surveyId: r.surveyId,
            institutionId: r.institutionId,
            status: r.status,
            dueDate: r.dueDate,
            createdAt: r.createdAt.toISOString(),
          })),
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
   * GET /surveys/:id/status
   * Get completion status for a survey.
   */
  fastify.get(
    `${prefix}/:id/status`,
    async function getSurveyStatusHandler(
      request: FastifyRequest<{ Params: SurveyParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SurveyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid survey ID',
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

      const status = await surveyService.getCompletionStatus(tenantId, paramsResult.data.id);
      return reply.status(200).send(status);
    },
  );

  /**
   * POST /surveys/:id/remind
   * Send reminders for incomplete submissions.
   */
  fastify.post(
    `${prefix}/:id/remind`,
    async function sendRemindersHandler(
      request: FastifyRequest<{ Params: SurveyParams; Body: { institutionIds?: string[] } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SurveyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid survey ID',
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
        const body = request.body as { institutionIds?: string[] } | undefined;
        const result = await surveyService.sendReminders(
          tenantId,
          paramsResult.data.id,
          body?.institutionIds,
        );
        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Submission Routes ───────────────────────────────────────────────

  /**
   * POST /surveys/submit
   * Submit survey responses for an institution.
   */
  fastify.post(
    `${prefix}/submit`,
    async function submitSurveyHandler(
      request: FastifyRequest<{ Body: SubmitSurveyInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(SubmitSurveySchema, request.body);
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
        const submission = await surveyService.submitSurvey(tenantId, result.data);
        return reply.status(201).send({
          id: submission.id,
          surveyId: submission.surveyId,
          institutionId: submission.institutionId,
          submittedAt: submission.submittedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Aggregation Routes ──────────────────────────────────────────────

  /**
   * GET /surveys/:id/aggregate
   * Get aggregated survey responses with optional cross-tabulation.
   */
  fastify.get(
    `${prefix}/:id/aggregate`,
    async function aggregateResponsesHandler(
      request: FastifyRequest<{ Params: SurveyParams; Querystring: { groupBy?: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SurveyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid survey ID',
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
        const query = request.query as { groupBy?: string };
        const groupBy = query.groupBy as 'area' | 'institution_type' | undefined;
        const result = await surveyService.aggregateResponses(
          tenantId,
          paramsResult.data.id,
          groupBy,
        );
        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
