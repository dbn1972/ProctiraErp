/**
 * Staff Routes
 *
 * POST   /staff              - Create a new staff record
 * PUT    /staff/:id          - Update a staff record
 * GET    /staff              - List staff (paginated, filterable, searchable)
 * GET    /staff/:id          - Get a single staff record
 * DELETE /staff/:id          - Delete a staff record
 * POST   /staff/:id/offboard - Thin offboard status stub (P1-HR)
 * GET    /staff/:id/offboard - Read thin offboard status
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  OffboardStaffParamsSchema,
  OffboardStaffSchema,
  type OffboardStaffInput,
  type OffboardStaffParams,
} from './offboard-schemas.js';
import {
  CreateStaffSchema,
  UpdateStaffSchema,
  StaffParamsSchema,
  type CreateStaffInput,
  type UpdateStaffInput,
  type StaffListQuery,
  type StaffParams,
} from './schemas.js';
import { canViewStaffIdentity, maskIdentityNumber } from './staff-access.js';
import {
  assertStaffWritableOr404,
  requireStaffAction,
  staffRequestRoles,
  staffWritePreHandler,
} from './staff-http-guard.js';
import type { StaffService } from './staff-service.js';

/**
 * Options for registering staff routes.
 */
export interface StaffRoutesOptions {
  staffService: StaffService;
  /** Route prefix (default: '/staff') */
  prefix?: string;
  /**
   * PRC-M120: staff ids with an approved leave covering `today` (YYYY-MM-DD).
   * When absent, `?type=ON_LEAVE` is rejected (fail closed) rather than
   * silently returning the full list.
   */
  onLeaveStaffIds?: (tenantId: string, today: string) => Promise<Set<string>>;
}

/**
 * Formats a staff entity to the API response shape.
 */
function formatStaffResponse(
  entity: {
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
  },
  opts: { maskIdentity?: boolean } = {},
) {
  return {
    id: entity.id,
    firstName: entity.firstName,
    lastName: entity.lastName,
    dateOfBirth: entity.dateOfBirth,
    identityNumber: opts.maskIdentity
      ? maskIdentityNumber(entity.identityNumber)
      : entity.identityNumber,
    contactPhone: entity.contactPhone,
    contactEmail: entity.contactEmail,
    position: entity.position,
    status: entity.status,
    customData: entity.customData,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/** Actor from verified JWT only (G-102 — never trust x-user-id headers). */
function getActorId(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string } }).user;
  return user?.sub ?? 'anonymous';
}

/**
 * Register staff routes on a Fastify instance.
 */
export async function registerStaffRoutes(
  fastify: FastifyInstance,
  options: StaffRoutesOptions,
): Promise<void> {
  const { staffService, prefix = '/staff', onLeaveStaffIds } = options;

  fastify.addHook('preHandler', async (request, reply) => {
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return;
    // PRC-L362: staff PII reads are domain-gated too (not only by the gateway).
    if (method === 'GET' || method === 'HEAD') {
      if (!requireStaffAction(request, reply, 'staff.read')) return reply;
      return;
    }
    const action =
      method === 'POST' ? 'staff.create' : method === 'DELETE' ? 'staff.delete' : 'staff.update';
    if (!staffWritePreHandler(request, reply, action)) return reply;
  });

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
        // PRC-H090: a school-bound caller may only update staff in its own institution(s).
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            tenantId,
            paramsResult.data.id,
          ))
        )
          return reply;
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
      const query = request.query;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'lastName';
      const sortOrder = (query.sortOrder ?? 'asc') as 'asc' | 'desc';
      // PRC-M120: staff type tabs.
      const type = query.type;
      if (type !== undefined && !['ALL', 'TEACHING', 'NON_TEACHING', 'ON_LEAVE'].includes(type)) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'type must be ALL, TEACHING, NON_TEACHING or ON_LEAVE',
          statusCode: 400,
        });
      }
      let ids: Set<string> | undefined;
      if (type === 'ON_LEAVE') {
        if (!onLeaveStaffIds) {
          return reply.status(501).send({
            code: 'ON_LEAVE_FILTER_UNAVAILABLE',
            message: 'On-leave filtering is not available in this deployment',
            statusCode: 501,
          });
        }
        ids = await onLeaveStaffIds(tenantId, new Date().toISOString().slice(0, 10));
      }

      const result = await staffService.list(
        tenantId,
        {
          status: query.status as 'ACTIVE' | 'INACTIVE' | undefined,
          position: query.position,
          search: query.search,
          institutionId: query.institutionId,
          ...(type === 'TEACHING' || type === 'NON_TEACHING' ? { staffType: type } : {}),
          ...(ids ? { ids } : {}),
        },
        { page, pageSize, sortBy, sortOrder },
      );

      const maskIdentity = !canViewStaffIdentity(staffRequestRoles(request));
      return reply.status(200).send({
        data: result.data.map((entity) => formatStaffResponse(entity, { maskIdentity })),
        meta: result.meta,
      });
    },
  );

  /**
   * POST /staff/:id/offboard — thin offboard status stub (P1-HR).
   * Registered before GET /:id so the static segment matches.
   */
  fastify.post(
    `${prefix}/:id/offboard`,
    async function offboardHandler(
      request: FastifyRequest<{ Params: OffboardStaffParams; Body: OffboardStaffInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(OffboardStaffParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid staff ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(OffboardStaffSchema, request.body ?? {});
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
        // PRC-H090: offboarding is a staff mutation — enforce school scope.
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            tenantId,
            paramsResult.data.id,
          ))
        )
          return reply;
        const view = await staffService.offboard(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
          getActorId(request),
        );
        return reply.status(200).send(view);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /staff/:id/offboard — read thin offboard status stub.
   */
  fastify.get(
    `${prefix}/:id/offboard`,
    async function getOffboardHandler(
      request: FastifyRequest<{ Params: OffboardStaffParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(OffboardStaffParamsSchema, request.params);
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
        const view = await staffService.getOffboardStatus(tenantId, paramsResult.data.id);
        return reply.status(200).send(view);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
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
        const maskIdentity = !canViewStaffIdentity(staffRequestRoles(request));
        return reply.status(200).send(formatStaffResponse(staff, { maskIdentity }));
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
        // PRC-H090: a school-bound caller may only delete staff in its own institution(s).
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            tenantId,
            paramsResult.data.id,
          ))
        )
          return reply;
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
