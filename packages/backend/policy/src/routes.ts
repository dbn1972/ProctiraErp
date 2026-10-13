/**
 * Policy Routes
 *
 * POST   /policies                    - Create a new policy
 * PUT    /policies/:id                - Update a policy
 * POST   /policies/:id/activate       - Activate a policy
 * POST   /policies/:id/deactivate     - Deactivate a policy
 * GET    /policies                    - List policies (paginated, filterable)
 * GET    /policies/:id                - Get a single policy
 * GET    /policies/:id/versions       - Get policy version history
 * POST   /policies/evaluate           - Evaluate effective policy for context
 * POST   /policies/:id/assignments    - Assign policy to a target
 * DELETE /policies/:id/assignments/:assignmentId - Remove assignment
 *
 * Charter: Section 27 (Security and Compliance)
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type {
  PolicyEntity,
  PolicyVersionEntity,
  PolicyAssignmentEntity,
} from './policy-repository.js';
import type { PolicyService } from './policy-service.js';
import {
  CreatePolicySchema,
  UpdatePolicySchema,
  PolicyParamsSchema,
  PolicyListQuerySchema,
  PolicyEvaluationRequestSchema,
  CreatePolicyAssignmentSchema,
  type CreatePolicyInput,
  type UpdatePolicyInput,
  type PolicyParams,
  type PolicyListQuery,
  type PolicyEvaluationRequest,
  type CreatePolicyAssignmentInput,
} from './schemas.js';

/**
 * Options for registering policy routes.
 */
export interface PolicyRoutesOptions {
  policyService: PolicyService;
  /** Route prefix (default: '/policies') */
  prefix?: string;
}

/**
 * Formats a policy entity to the API response shape.
 */
function formatPolicyResponse(entity: PolicyEntity) {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    type: entity.type,
    scope: entity.scope,
    status: entity.status,
    rules: entity.rules,
    version: entity.version,
    effectiveFrom: entity.effectiveFrom?.toISOString() ?? null,
    effectiveUntil: entity.effectiveUntil?.toISOString() ?? null,
    priority: entity.priority,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Formats a policy version entity to the API response shape.
 */
function formatVersionResponse(entity: PolicyVersionEntity) {
  return {
    id: entity.id,
    policyId: entity.policyId,
    version: entity.version,
    rules: entity.rules,
    effectiveFrom: entity.effectiveFrom?.toISOString() ?? null,
    effectiveUntil: entity.effectiveUntil?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
    createdBy: entity.createdBy,
  };
}

/**
 * Formats a policy assignment entity to the API response shape.
 */
function formatAssignmentResponse(entity: PolicyAssignmentEntity) {
  return {
    id: entity.id,
    policyId: entity.policyId,
    targetType: entity.targetType,
    targetId: entity.targetId,
    createdAt: entity.createdAt.toISOString(),
  };
}

/**
 * Register policy routes on a Fastify instance.
 */
export async function registerPolicyRoutes(
  fastify: FastifyInstance,
  options: PolicyRoutesOptions,
): Promise<void> {
  const { policyService, prefix = '/policies' } = options;

  /**
   * POST /policies
   * Create a new policy.
   */
  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreatePolicyInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreatePolicySchema, request.body);
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
        const policy = await policyService.create(tenantId, result.data);
        return reply.status(201).send(formatPolicyResponse(policy));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /policies/:id
   * Update an existing policy.
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: PolicyParams; Body: UpdatePolicyInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PolicyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid policy ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdatePolicySchema, request.body);
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
        const policy = await policyService.update(tenantId, paramsResult.data.id, bodyResult.data);
        return reply.status(200).send(formatPolicyResponse(policy));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /policies/:id/activate
   * Activate a policy.
   */
  fastify.post(
    `${prefix}/:id/activate`,
    async function activateHandler(
      request: FastifyRequest<{ Params: PolicyParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PolicyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid policy ID',
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
        const policy = await policyService.activate(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatPolicyResponse(policy));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /policies/:id/deactivate
   * Deactivate a policy.
   */
  fastify.post(
    `${prefix}/:id/deactivate`,
    async function deactivateHandler(
      request: FastifyRequest<{ Params: PolicyParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PolicyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid policy ID',
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
        const policy = await policyService.deactivate(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatPolicyResponse(policy));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /policies
   * List policies with pagination and filtering.
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: PolicyListQuery }>,
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

      // PRC-M611: validate the query against its schema so pageSize is capped
      // (1..100) and sortBy/sortOrder are restricted to known values; a bad
      // pageSize/sortBy is a 400, never an uncapped or injected sort.
      const rawQuery = request.query as Record<string, unknown>;
      const coerced = {
        ...rawQuery,
        ...(rawQuery['page'] != null ? { page: Number(rawQuery['page']) } : {}),
        ...(rawQuery['pageSize'] != null ? { pageSize: Number(rawQuery['pageSize']) } : {}),
      };
      const parsed = validate(PolicyListQuerySchema, coerced);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          statusCode: 400,
          errors: parsed.errors,
        });
      }
      const query = parsed.data;
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const sortBy = query.sortBy ?? 'name';
      const sortOrder = query.sortOrder ?? 'asc';

      const result = await policyService.list(
        tenantId,
        {
          type: query.type,
          scope: query.scope,
          status: query.status,
          search: query.search,
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map(formatPolicyResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /policies/:id
   * Get a single policy by ID.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: PolicyParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PolicyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid policy ID',
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
        const policy = await policyService.getById(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatPolicyResponse(policy));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /policies/:id/versions
   * Get version history for a policy.
   */
  fastify.get(
    `${prefix}/:id/versions`,
    async function versionsHandler(
      request: FastifyRequest<{ Params: PolicyParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PolicyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid policy ID',
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
        const versions = await policyService.getVersions(tenantId, paramsResult.data.id);
        return reply.status(200).send({
          data: versions.map(formatVersionResponse),
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
   * POST /policies/evaluate
   * Evaluate the effective policy for a given context.
   */
  fastify.post(
    `${prefix}/evaluate`,
    async function evaluateHandler(
      request: FastifyRequest<{ Body: PolicyEvaluationRequest }>,
      reply: FastifyReply,
    ) {
      const result = validate(PolicyEvaluationRequestSchema, request.body);
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
        // PRC-M607: the tenant comes ONLY from the validated request context
        // (JWT-derived tenantId), never from the request body. A body-supplied
        // tenantId is ignored so a caller cannot evaluate another tenant's policies.
        const evaluation = await policyService.evaluate({
          type: result.data.type,
          tenantId,
          institutionId: result.data.institutionId,
        });
        return reply.status(200).send(evaluation);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /policies/:id/assignments
   * Assign a policy to a target scope.
   */
  fastify.post(
    `${prefix}/:id/assignments`,
    async function assignHandler(
      request: FastifyRequest<{ Params: PolicyParams; Body: CreatePolicyAssignmentInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PolicyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid policy ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(CreatePolicyAssignmentSchema, request.body);
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

      // Ensure the policyId in the body matches the URL param
      if (bodyResult.data.policyId !== paramsResult.data.id) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Policy ID in body must match URL parameter',
          statusCode: 400,
        });
      }

      try {
        const assignment = await policyService.assignPolicy(tenantId, bodyResult.data);
        return reply.status(201).send(formatAssignmentResponse(assignment));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /policies/:id/assignments
   * Get all assignments for a policy.
   */
  fastify.get(
    `${prefix}/:id/assignments`,
    async function getAssignmentsHandler(
      request: FastifyRequest<{ Params: PolicyParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PolicyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid policy ID',
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
        const assignments = await policyService.getAssignments(tenantId, paramsResult.data.id);
        return reply.status(200).send({
          data: assignments.map(formatAssignmentResponse),
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
   * DELETE /policies/:id/assignments/:assignmentId
   * Remove a policy assignment.
   */
  fastify.delete(
    `${prefix}/:id/assignments/:assignmentId`,
    async function removeAssignmentHandler(
      request: FastifyRequest<{ Params: { id: string; assignmentId: string } }>,
      reply: FastifyReply,
    ) {
      // PRC-L487: validate BOTH ids as UUIDs and tie the assignment to the policy :id.
      const idOk = validate(PolicyParamsSchema, { id: request.params.id });
      const assignmentOk = validate(PolicyParamsSchema, { id: request.params.assignmentId });
      if (!idOk.success || !assignmentOk.success) {
        const errors = !idOk.success
          ? idOk.errors
          : !assignmentOk.success
            ? assignmentOk.errors
            : [];
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid policy or assignment ID',
          statusCode: 400,
          errors,
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
        await policyService.removeAssignment(
          tenantId,
          request.params.id,
          request.params.assignmentId,
        );
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
