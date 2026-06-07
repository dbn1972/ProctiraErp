/**
 * Staff Assignment Routes
 *
 * POST   /staff/assignments       - Create a new assignment
 * PUT    /staff/assignments/:id   - Update an assignment
 * GET    /staff/assignments       - List assignments (paginated, filterable)
 * GET    /staff/assignments/:id   - Get a single assignment
 * DELETE /staff/assignments/:id   - Delete an assignment
 *
 * Requirements:
 * - 7.2: Track staff assignments with start/end dates, prevent overlapping
 * - 7.5: Track allocation percentage, enforce total ≤ 100%
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { StaffAssignmentService } from './assignment-service.js';
import {
  CreateAssignmentSchema,
  UpdateAssignmentSchema,
  AssignmentParamsSchema,
  type CreateAssignmentInput,
  type UpdateAssignmentInput,
  type AssignmentListQuery,
  type AssignmentParams,
} from './assignment-schemas.js';

/**
 * Options for registering assignment routes.
 */
export interface AssignmentRoutesOptions {
  assignmentService: StaffAssignmentService;
  /** Route prefix (default: '/staff/assignments') */
  prefix?: string;
}

/**
 * Formats an assignment entity to the API response shape.
 */
function formatAssignmentResponse(entity: {
  id: string;
  staffId: string;
  institutionId: string;
  subjectId: string;
  classId: string;
  role: string;
  allocationPercentage: number;
  startDate: string;
  endDate: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    staffId: entity.staffId,
    institutionId: entity.institutionId,
    subjectId: entity.subjectId,
    classId: entity.classId,
    role: entity.role,
    allocationPercentage: entity.allocationPercentage,
    startDate: entity.startDate,
    endDate: entity.endDate,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register staff assignment routes on a Fastify instance.
 */
export async function registerAssignmentRoutes(
  fastify: FastifyInstance,
  options: AssignmentRoutesOptions,
): Promise<void> {
  const { assignmentService, prefix = '/staff/assignments' } = options;

  /**
   * POST /staff/assignments
   * Create a new staff assignment.
   */
  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateAssignmentInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateAssignmentSchema, request.body);
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
        const assignment = await assignmentService.create(tenantId, result.data);
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
   * PUT /staff/assignments/:id
   * Update an existing staff assignment.
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: AssignmentParams; Body: UpdateAssignmentInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AssignmentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid assignment ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateAssignmentSchema, request.body);
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
        const assignment = await assignmentService.update(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatAssignmentResponse(assignment));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /staff/assignments
   * List assignments with pagination and filtering.
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: AssignmentListQuery }>,
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

      const query = request.query as AssignmentListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await assignmentService.list(
        tenantId,
        {
          staffId: query.staffId,
          institutionId: query.institutionId,
          subjectId: query.subjectId,
          classId: query.classId,
          status: query.status as 'ACTIVE' | 'INACTIVE' | undefined,
        },
        { page, pageSize },
      );

      return reply.status(200).send({
        data: result.data.map(formatAssignmentResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /staff/assignments/:id
   * Get a single assignment by ID.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: AssignmentParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AssignmentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid assignment ID',
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
        const assignment = await assignmentService.getById(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatAssignmentResponse(assignment));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /staff/assignments/:id
   * Delete an assignment.
   */
  fastify.delete(
    `${prefix}/:id`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: AssignmentParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AssignmentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid assignment ID',
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
        await assignmentService.delete(tenantId, paramsResult.data.id);
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
