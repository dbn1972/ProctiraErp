/**
 * Workflow Engine Routes
 *
 * POST   /workflows                          - Create a workflow definition
 * GET    /workflows                          - List workflow definitions
 * GET    /workflows/:id                      - Get a workflow definition
 * PUT    /workflows/:id                      - Update a workflow definition
 * DELETE /workflows/:id                      - Delete a workflow definition
 * POST   /workflows/instances                - Create a workflow instance
 * GET    /workflows/instances                - List workflow instances
 * GET    /workflows/instances/:instanceId    - Get a workflow instance
 * POST   /workflows/instances/:instanceId/transition - Transition a workflow instance
 * GET    /workflows/instances/:instanceId/audit      - Get transition audit history
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { WorkflowService } from './workflow-service.js';
import {
  CreateWorkflowDefinitionSchema,
  UpdateWorkflowDefinitionSchema,
  CreateWorkflowInstanceSchema,
  TransitionRequestSchema,
  WorkflowDefinitionParamsSchema,
  WorkflowInstanceParamsSchema,
  type CreateWorkflowDefinitionInput,
  type UpdateWorkflowDefinitionInput,
  type CreateWorkflowInstanceInput,
  type TransitionRequestInput,
  type WorkflowDefinitionParams,
  type WorkflowInstanceParams,
  type WorkflowDefinitionListQuery,
  type WorkflowInstanceListQuery,
} from './schemas.js';
import type { WorkflowDefinitionEntity, WorkflowInstanceEntity, TransitionAuditEntity } from './workflow-repository.js';

/**
 * Options for registering workflow routes.
 */
export interface WorkflowRoutesOptions {
  workflowService: WorkflowService;
  /** Route prefix (default: '/workflows') */
  prefix?: string;
}

/**
 * Formats a workflow definition entity to the API response shape.
 */
function formatDefinitionResponse(entity: WorkflowDefinitionEntity) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    entityType: entity.entityType,
    description: entity.description,
    states: entity.states,
    transitions: entity.transitions,
    escalationRules: entity.escalationRules,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Formats a workflow instance entity to the API response shape.
 */
function formatInstanceResponse(entity: WorkflowInstanceEntity) {
  return {
    id: entity.id,
    workflowDefinitionId: entity.workflowDefinitionId,
    entityType: entity.entityType,
    entityId: entity.entityId,
    currentStateId: entity.currentStateId,
    status: entity.status,
    metadata: entity.metadata,
    approvals: entity.approvals.map((a) => ({
      stateId: a.stateId,
      actorId: a.actorId,
      action: a.action,
      timestamp: a.timestamp.toISOString(),
    })),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Formats a transition audit entity to the API response shape.
 */
function formatAuditResponse(entity: TransitionAuditEntity) {
  return {
    id: entity.id,
    instanceId: entity.instanceId,
    fromStateId: entity.fromStateId,
    toStateId: entity.toStateId,
    action: entity.action,
    actorId: entity.actorId,
    comments: entity.comments,
    timestamp: entity.timestamp.toISOString(),
  };
}

/**
 * Extracts tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/**
 * Register workflow routes on a Fastify instance.
 */
export async function registerWorkflowRoutes(
  fastify: FastifyInstance,
  options: WorkflowRoutesOptions,
): Promise<void> {
  const { workflowService, prefix = '/workflows' } = options;

  // ─── Workflow Definition Routes ────────────────────────────────────────

  /**
   * POST /workflows
   * Create a new workflow definition.
   */
  fastify.post(
    prefix,
    async function createDefinitionHandler(
      request: FastifyRequest<{ Body: CreateWorkflowDefinitionInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateWorkflowDefinitionSchema, request.body);
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
        const definition = await workflowService.createDefinition(tenantId, result.data);
        return reply.status(201).send(formatDefinitionResponse(definition));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /workflows
   * List workflow definitions with pagination.
   */
  fastify.get(
    prefix,
    async function listDefinitionsHandler(
      request: FastifyRequest<{ Querystring: WorkflowDefinitionListQuery }>,
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

      const result = await workflowService.listDefinitions(
        tenantId,
        { entityType: query.entityType },
        { page, pageSize },
      );

      return reply.status(200).send({
        data: result.data.map(formatDefinitionResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /workflows/:id
   * Get a workflow definition by ID.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getDefinitionHandler(
      request: FastifyRequest<{ Params: WorkflowDefinitionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(WorkflowDefinitionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid workflow definition ID',
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
        const definition = await workflowService.getDefinition(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatDefinitionResponse(definition));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /workflows/:id
   * Update a workflow definition.
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateDefinitionHandler(
      request: FastifyRequest<{ Params: WorkflowDefinitionParams; Body: UpdateWorkflowDefinitionInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(WorkflowDefinitionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid workflow definition ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateWorkflowDefinitionSchema, request.body);
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
        const definition = await workflowService.updateDefinition(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatDefinitionResponse(definition));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /workflows/:id
   * Delete a workflow definition.
   */
  fastify.delete(
    `${prefix}/:id`,
    async function deleteDefinitionHandler(
      request: FastifyRequest<{ Params: WorkflowDefinitionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(WorkflowDefinitionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid workflow definition ID',
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
        await workflowService.deleteDefinition(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Workflow Instance Routes ──────────────────────────────────────────

  /**
   * POST /workflows/instances
   * Create a new workflow instance linked to an entity.
   */
  fastify.post(
    `${prefix}/instances`,
    async function createInstanceHandler(
      request: FastifyRequest<{ Body: CreateWorkflowInstanceInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateWorkflowInstanceSchema, request.body);
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
        const instance = await workflowService.createInstance(tenantId, result.data);
        return reply.status(201).send(formatInstanceResponse(instance));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /workflows/instances
   * List workflow instances with pagination and filtering.
   */
  fastify.get(
    `${prefix}/instances`,
    async function listInstancesHandler(
      request: FastifyRequest<{ Querystring: WorkflowInstanceListQuery }>,
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

      const result = await workflowService.listInstances(
        tenantId,
        {
          entityType: query.entityType,
          entityId: query.entityId,
          status: query.status,
        },
        { page, pageSize },
      );

      return reply.status(200).send({
        data: result.data.map(formatInstanceResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /workflows/instances/:instanceId
   * Get a workflow instance by ID.
   */
  fastify.get(
    `${prefix}/instances/:instanceId`,
    async function getInstanceHandler(
      request: FastifyRequest<{ Params: WorkflowInstanceParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(WorkflowInstanceParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid workflow instance ID',
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
        const instance = await workflowService.getInstance(tenantId, paramsResult.data.instanceId);
        return reply.status(200).send(formatInstanceResponse(instance));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /workflows/instances/:instanceId/transition
   * Perform a state transition on a workflow instance.
   */
  fastify.post(
    `${prefix}/instances/:instanceId/transition`,
    async function transitionHandler(
      request: FastifyRequest<{ Params: WorkflowInstanceParams; Body: TransitionRequestInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(WorkflowInstanceParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid workflow instance ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(TransitionRequestSchema, request.body);
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
        const instance = await workflowService.transition(
          tenantId,
          paramsResult.data.instanceId,
          bodyResult.data,
        );
        return reply.status(200).send(formatInstanceResponse(instance));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /workflows/instances/:instanceId/audit
   * Get the transition audit history for a workflow instance.
   */
  fastify.get(
    `${prefix}/instances/:instanceId/audit`,
    async function getAuditHandler(
      request: FastifyRequest<{ Params: WorkflowInstanceParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(WorkflowInstanceParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid workflow instance ID',
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
        const auditHistory = await workflowService.getAuditHistory(
          tenantId,
          paramsResult.data.instanceId,
        );
        return reply.status(200).send({
          data: auditHistory.map(formatAuditResponse),
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
