/**
 * Case Management Routes
 *
 * POST   /workflows/cases                    - Create a case
 * GET    /workflows/cases                    - List cases
 * GET    /workflows/cases/:caseId            - Get a case
 * PUT    /workflows/cases/:caseId            - Update a case
 * POST   /workflows/cases/:caseId/attachments - Add attachment to a case
 * POST   /workflows/cases/:caseId/resolve    - Resolve a case
 *
 * Requirements: 13.5
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { CaseService } from './case-service.js';
import {
  CreateCaseSchema,
  UpdateCaseSchema,
  AddAttachmentSchema,
  ResolveCaseSchema,
  CaseParamsSchema,
  type CreateCaseInput,
  type UpdateCaseInput,
  type AddAttachmentInput,
  type ResolveCaseInput,
  type CaseParams,
  type CaseListQuery,
} from './case-schemas.js';
import type { CaseEntity } from './case-repository.js';

/**
 * Options for registering case routes.
 */
export interface CaseRoutesOptions {
  caseService: CaseService;
  /** Route prefix (default: '/workflows/cases') */
  prefix?: string;
}

/**
 * Formats a case entity to the API response shape.
 */
function formatCaseResponse(entity: CaseEntity) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    type: entity.type,
    title: entity.title,
    description: entity.description,
    status: entity.status,
    entityType: entity.entityType,
    entityId: entity.entityId,
    institutionId: entity.institutionId,
    areaId: entity.areaId,
    assignedTo: entity.assignedTo,
    priority: entity.priority,
    workflowInstanceId: entity.workflowInstanceId,
    attachments: entity.attachments,
    resolution: entity.resolution,
    metadata: entity.metadata,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Extracts tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/**
 * Register case management routes on a Fastify instance.
 */
export async function registerCaseRoutes(
  fastify: FastifyInstance,
  options: CaseRoutesOptions,
): Promise<void> {
  const { caseService, prefix = '/workflows/cases' } = options;

  /**
   * POST /workflows/cases
   * Create a new case.
   */
  fastify.post(
    prefix,
    async function createCaseHandler(
      request: FastifyRequest<{ Body: CreateCaseInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateCaseSchema, request.body);
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
        const caseEntity = await caseService.createCase(tenantId, result.data);
        return reply.status(201).send(formatCaseResponse(caseEntity));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /workflows/cases
   * List cases with pagination and filtering.
   */
  fastify.get(
    prefix,
    async function listCasesHandler(
      request: FastifyRequest<{ Querystring: CaseListQuery }>,
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

      const query = request.query;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await caseService.listCases(
        tenantId,
        {
          type: query.type,
          status: query.status,
          entityType: query.entityType,
          entityId: query.entityId,
          assignedTo: query.assignedTo,
        },
        { page, pageSize },
      );

      return reply.status(200).send({
        data: result.data.map(formatCaseResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /workflows/cases/:caseId
   * Get a case by ID.
   */
  fastify.get(
    `${prefix}/:caseId`,
    async function getCaseHandler(
      request: FastifyRequest<{ Params: CaseParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CaseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid case ID',
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
        const caseEntity = await caseService.getCase(tenantId, paramsResult.data.caseId);
        return reply.status(200).send(formatCaseResponse(caseEntity));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /workflows/cases/:caseId
   * Update a case.
   */
  fastify.put(
    `${prefix}/:caseId`,
    async function updateCaseHandler(
      request: FastifyRequest<{ Params: CaseParams; Body: UpdateCaseInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CaseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid case ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateCaseSchema, request.body);
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
        const caseEntity = await caseService.updateCase(
          tenantId,
          paramsResult.data.caseId,
          bodyResult.data,
        );
        return reply.status(200).send(formatCaseResponse(caseEntity));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /workflows/cases/:caseId/attachments
   * Add an attachment to a case.
   */
  fastify.post(
    `${prefix}/:caseId/attachments`,
    async function addAttachmentHandler(
      request: FastifyRequest<{ Params: CaseParams; Body: AddAttachmentInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CaseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid case ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(AddAttachmentSchema, request.body);
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
        const caseEntity = await caseService.addAttachment(
          tenantId,
          paramsResult.data.caseId,
          bodyResult.data,
        );
        return reply.status(200).send(formatCaseResponse(caseEntity));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /workflows/cases/:caseId/resolve
   * Resolve a case with outcome and notes.
   */
  fastify.post(
    `${prefix}/:caseId/resolve`,
    async function resolveCaseHandler(
      request: FastifyRequest<{ Params: CaseParams; Body: ResolveCaseInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CaseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid case ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(ResolveCaseSchema, request.body);
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
        const caseEntity = await caseService.resolveCase(
          tenantId,
          paramsResult.data.caseId,
          bodyResult.data,
        );
        return reply.status(200).send(formatCaseResponse(caseEntity));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
