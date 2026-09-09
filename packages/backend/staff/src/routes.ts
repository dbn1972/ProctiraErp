/**
 * Staff Routes
 *
 * POST   /staff       - Create a new staff record
 * PUT    /staff/:id   - Update a staff record
 * GET    /staff       - List staff (paginated, filterable, searchable)
 * GET    /staff/:id   - Get a single staff record
 * DELETE /staff/:id   - Delete a staff record
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { StaffService } from './staff-service.js';
import {
  CreateStaffSchema,
  UpdateStaffSchema,
  StaffParamsSchema,
  type CreateStaffInput,
  type UpdateStaffInput,
  type StaffListQuery,
  type StaffParams,
} from './schemas.js';

/**
 * Options for registering staff routes.
 */
export interface StaffRoutesOptions {
  staffService: StaffService;
  /** Route prefix (default: '/staff') */
  prefix?: string;
}

/**
 * Formats a staff entity to the API response shape.
 */
function formatStaffResponse(entity: {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identityNumber: string;
  contactPhone: string;
  contactEmail: string | null;
  position: string;
  status: string;
  customData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    firstName: entity.firstName,
    lastName: entity.lastName,
    dateOfBirth: entity.dateOfBirth,
    identityNumber: entity.identityNumber,
    contactPhone: entity.contactPhone,
    contactEmail: entity.contactEmail,
    position: entity.position,
    status: entity.status,
    customData: entity.customData,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register staff routes on a Fastify instance.
 */
export async function registerStaffRoutes(
  fastify: FastifyInstance,
  options: StaffRoutesOptions,
): Promise<void> {
  const { staffService, prefix = '/staff' } = options;

  /**
   * POST /staff
   * Create a new staff record.
   */
  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateStaffInput }>,
      reply: FastifyReply,
    ) {
      // Validate request body
      const result = validate(CreateStaffSchema, request.body);
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
        const staff = await staffService.create(tenantId, result.data);
        return reply.status(201).send(formatStaffResponse(staff));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /staff/:id
   * Update an existing staff record.
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: StaffParams; Body: UpdateStaffInput }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(StaffParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid staff ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      // Validate body
      const bodyResult = validate(UpdateStaffSchema, request.body);
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
        const staff = await staffService.update(tenantId, paramsResult.data.id, bodyResult.data);
        return reply.status(200).send(formatStaffResponse(staff));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /staff
   * List staff with pagination and filtering.
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: StaffListQuery }>,
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

      // Parse query with defaults
      const query = request.query as StaffListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'lastName';
      const sortOrder = (query.sortOrder ?? 'asc') as 'asc' | 'desc';

      const result = await staffService.list(
        tenantId,
        {
          status: query.status as 'ACTIVE' | 'INACTIVE' | undefined,
          position: query.position,
          search: query.search,
          institutionId: query.institutionId,},
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map(formatStaffResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /staff/:id
   * Get a single staff record by ID.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: StaffParams }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(StaffParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid staff ID',
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
        const staff = await staffService.getById(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatStaffResponse(staff));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /staff/:id
   * Delete a staff record.
   */
  fastify.delete(
    `${prefix}/:id`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: StaffParams }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(StaffParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid staff ID',
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
        await staffService.delete(tenantId, paramsResult.data.id);
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
