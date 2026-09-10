/**
 * Appraisal Routes
 *
 * POST   /staff/appraisals/templates       - Create an appraisal template
 * GET    /staff/appraisals/templates        - List appraisal templates
 * GET    /staff/appraisals/templates/:templateId - Get a template
 * POST   /staff/appraisals                  - Create an appraisal
 * GET    /staff/appraisals                  - List appraisals
 * GET    /staff/appraisals/:id              - Get an appraisal
 * POST   /staff/appraisals/:id/submit       - Submit appraisal for workflow approval
 *
 * Requirements:
 * - 7.3: Staff appraisal workflows with configurable criteria, scoring, and approval chains
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  CreateAppraisalTemplateSchema,
  CreateAppraisalSchema,
  AppraisalParamsSchema,
  AppraisalTemplateParamsSchema,
  type CreateAppraisalTemplateInput,
  type CreateAppraisalInput,
  type AppraisalParams,
  type AppraisalTemplateParams,
  type AppraisalListQuery,
} from './appraisal-schemas.js';
import type { AppraisalService } from './appraisal-service.js';

/**
 * Options for registering appraisal routes.
 */
export interface AppraisalRoutesOptions {
  appraisalService: AppraisalService;
  prefix?: string;
}

/**
 * Format appraisal template entity to response shape.
 */
function formatTemplateResponse(entity: {
  id: string;
  name: string;
  description: string | null;
  academicPeriodId: string;
  criteria: Array<{ name: string; description: string | null; weight: number; maxScore: number }>;
  scoreMin: number;
  scoreMax: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    academicPeriodId: entity.academicPeriodId,
    criteria: entity.criteria,
    scoreMin: entity.scoreMin,
    scoreMax: entity.scoreMax,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format appraisal entity to response shape.
 */
function formatAppraisalResponse(entity: {
  id: string;
  staffId: string;
  templateId: string;
  appraisalDate: string;
  scores: Array<{ criterionName: string; score: number; comment: string | null }>;
  totalScore: number;
  overallComment: string | null;
  status: string;
  workflowInstanceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    staffId: entity.staffId,
    templateId: entity.templateId,
    appraisalDate: entity.appraisalDate,
    scores: entity.scores,
    totalScore: entity.totalScore,
    overallComment: entity.overallComment,
    status: entity.status,
    workflowInstanceId: entity.workflowInstanceId,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register appraisal routes on a Fastify instance.
 */
export async function registerAppraisalRoutes(
  fastify: FastifyInstance,
  options: AppraisalRoutesOptions,
): Promise<void> {
  const { appraisalService, prefix = '/staff/appraisals' } = options;

  /**
   * POST /staff/appraisals/templates
   * Create an appraisal template with configurable criteria.
   */
  fastify.post(
    `${prefix}/templates`,
    async function createTemplateHandler(
      request: FastifyRequest<{ Body: CreateAppraisalTemplateInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateAppraisalTemplateSchema, request.body);
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
        const template = await appraisalService.createTemplate(tenantId, result.data);
        return reply.status(201).send(formatTemplateResponse(template));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /staff/appraisals/templates
   * List appraisal templates.
   */
  fastify.get(
    `${prefix}/templates`,
    async function listTemplatesHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const query = request.query as { page?: string; pageSize?: string };
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await appraisalService.listTemplates(tenantId, { page, pageSize });
      return reply.status(200).send({
        data: result.data.map(formatTemplateResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /staff/appraisals/templates/:templateId
   * Get a single appraisal template.
   */
  fastify.get(
    `${prefix}/templates/:templateId`,
    async function getTemplateHandler(
      request: FastifyRequest<{ Params: AppraisalTemplateParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AppraisalTemplateParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid template ID',
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
        const template = await appraisalService.getTemplate(tenantId, paramsResult.data.templateId);
        return reply.status(200).send(formatTemplateResponse(template));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /staff/appraisals
   * Create a staff appraisal with scores.
   */
  fastify.post(
    prefix,
    async function createAppraisalHandler(
      request: FastifyRequest<{ Body: CreateAppraisalInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateAppraisalSchema, request.body);
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
        const appraisal = await appraisalService.createAppraisal(tenantId, result.data);
        return reply.status(201).send(formatAppraisalResponse(appraisal));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /staff/appraisals
   * List appraisals with filtering.
   */
  fastify.get(
    prefix,
    async function listAppraisalsHandler(
      request: FastifyRequest<{ Querystring: AppraisalListQuery }>,
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

      const query = request.query;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await appraisalService.listAppraisals(
        tenantId,
        {
          staffId: query.staffId,
          templateId: query.templateId,
          status: query.status,
        },
        { page, pageSize },
      );

      return reply.status(200).send({
        data: result.data.map(formatAppraisalResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /staff/appraisals/:id
   * Get a single appraisal.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getAppraisalHandler(
      request: FastifyRequest<{ Params: AppraisalParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AppraisalParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid appraisal ID',
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
        const appraisal = await appraisalService.getAppraisal(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatAppraisalResponse(appraisal));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /staff/appraisals/:id/submit
   * Submit an appraisal for workflow approval.
   */
  fastify.post(
    `${prefix}/:id/submit`,
    async function submitAppraisalHandler(
      request: FastifyRequest<{ Params: AppraisalParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AppraisalParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid appraisal ID',
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
        const appraisal = await appraisalService.submitAppraisal(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatAppraisalResponse(appraisal));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
