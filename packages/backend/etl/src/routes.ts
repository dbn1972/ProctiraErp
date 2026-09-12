/**
 * ETL Routes
 *
 * POST   /pipelines                              - Create a new pipeline
 * GET    /pipelines                              - List pipelines
 * GET    /pipelines/:pipelineId                  - Get a pipeline by ID
 * PUT    /pipelines/:pipelineId                  - Update a pipeline
 * DELETE /pipelines/:pipelineId                  - Delete a pipeline
 * POST   /pipelines/:pipelineId/execute          - Execute a pipeline
 * GET    /pipelines/:pipelineId/executions       - List executions for a pipeline
 * GET    /pipelines/:pipelineId/executions/:executionId - Get execution details
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { ETLService } from './etl-service.js';
import {
  CreatePipelineSchema,
  UpdatePipelineSchema,
  PipelineParamsSchema,
  PipelineListQuerySchema,
  type CreatePipelineInput,
  type UpdatePipelineInput,
  type PipelineParams,
  type PipelineListQuery,
  type Pipeline,
  type PipelineExecution,
} from './schemas.js';

/**
 * Options for registering ETL routes.
 */
export interface ETLRoutesOptions {
  etlService: ETLService;
  /** Route prefix (default: '/pipelines') */
  prefix?: string;
}

/**
 * Format a pipeline entity for API response.
 */
function formatPipelineResponse(entity: Pipeline) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    description: entity.description,
    source: entity.source,
    destination: entity.destination,
    fieldMappings: entity.fieldMappings,
    schedule: entity.schedule,
    retryPolicy: entity.retryPolicy,
    enabled: entity.enabled,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format an execution entity for API response.
 */
function formatExecutionResponse(entity: PipelineExecution) {
  return {
    id: entity.id,
    pipelineId: entity.pipelineId,
    tenantId: entity.tenantId,
    status: entity.status,
    startedAt: entity.startedAt.toISOString(),
    completedAt: entity.completedAt?.toISOString() ?? null,
    extractedCount: entity.extractedCount,
    transformedCount: entity.transformedCount,
    loadedCount: entity.loadedCount,
    errorCount: entity.errorCount,
    errors: entity.errors,
    lineage: entity.lineage ?? null,
  };
}

/**
 * Extract tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | undefined {
  return (request as FastifyRequest & { tenantId?: string }).tenantId;
}

/**
 * Register ETL routes on a Fastify instance.
 */
export async function registerETLRoutes(
  fastify: FastifyInstance,
  options: ETLRoutesOptions,
): Promise<void> {
  const { etlService, prefix = '/pipelines' } = options;

  /**
   * POST /pipelines
   * Create a new pipeline definition.
   */
  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreatePipelineInput }>,
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

      const result = validate(CreatePipelineSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const pipeline = await etlService.createPipeline(tenantId, result.data);
        return reply.status(201).send(formatPipelineResponse(pipeline));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /pipelines
   * List pipelines with filtering and pagination.
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: PipelineListQuery }>,
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

      const query = request.query as PipelineListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await etlService.listPipelines(
        tenantId,
        { search: query.search, enabled: query.enabled },
        page,
        pageSize,
      );

      return reply.status(200).send({
        data: result.data.map(formatPipelineResponse),
        meta: {
          page,
          pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / pageSize),
        },
      });
    },
  );

  /**
   * GET /pipelines/:pipelineId
   * Get a single pipeline by ID.
   */
  fastify.get(
    `${prefix}/:pipelineId`,
    async function getHandler(
      request: FastifyRequest<{ Params: PipelineParams }>,
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

      const paramsResult = validate(PipelineParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid pipeline ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const pipeline = await etlService.getPipeline(tenantId, paramsResult.data.pipelineId);
        return reply.status(200).send(formatPipelineResponse(pipeline));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /pipelines/:pipelineId
   * Update an existing pipeline.
   */
  fastify.put(
    `${prefix}/:pipelineId`,
    async function updateHandler(
      request: FastifyRequest<{ Params: PipelineParams; Body: UpdatePipelineInput }>,
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

      const paramsResult = validate(PipelineParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid pipeline ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdatePipelineSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const pipeline = await etlService.updatePipeline(
          tenantId,
          paramsResult.data.pipelineId,
          bodyResult.data,
        );
        return reply.status(200).send(formatPipelineResponse(pipeline));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /pipelines/:pipelineId
   * Delete a pipeline.
   */
  fastify.delete(
    `${prefix}/:pipelineId`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: PipelineParams }>,
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

      const paramsResult = validate(PipelineParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid pipeline ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        await etlService.deletePipeline(tenantId, paramsResult.data.pipelineId);
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
   * POST /pipelines/:pipelineId/execute
   * Execute a pipeline (trigger ETL run).
   */
  fastify.post(
    `${prefix}/:pipelineId/execute`,
    async function executeHandler(
      request: FastifyRequest<{ Params: PipelineParams }>,
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

      const paramsResult = validate(PipelineParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid pipeline ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const execution = await etlService.executePipeline(tenantId, paramsResult.data.pipelineId);
        return reply.status(202).send(formatExecutionResponse(execution));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /pipelines/:pipelineId/executions
   * List executions for a pipeline.
   */
  fastify.get(
    `${prefix}/:pipelineId/executions`,
    async function listExecutionsHandler(
      request: FastifyRequest<{ Params: PipelineParams; Querystring: PipelineListQuery }>,
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

      const paramsResult = validate(PipelineParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid pipeline ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const query = request.query as PipelineListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      try {
        const result = await etlService.listExecutions(
          tenantId,
          paramsResult.data.pipelineId,
          page,
          pageSize,
        );

        return reply.status(200).send({
          data: result.data.map(formatExecutionResponse),
          meta: {
            page,
            pageSize,
            total: result.total,
            totalPages: Math.ceil(result.total / pageSize),
          },
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
   * GET /pipelines/:pipelineId/executions/:executionId
   * Get execution details.
   */
  fastify.get(
    `${prefix}/:pipelineId/executions/:executionId`,
    async function getExecutionHandler(
      request: FastifyRequest<{ Params: { pipelineId: string; executionId: string } }>,
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

      const executionId = request.params.executionId;

      try {
        const execution = await etlService.getExecution(tenantId, executionId);
        return reply.status(200).send(formatExecutionResponse(execution));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
