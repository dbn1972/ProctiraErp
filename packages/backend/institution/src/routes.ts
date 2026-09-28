/**
 * Institution Routes
 *
 * POST   /institutions       - Create a new institution
 * PUT    /institutions/:id   - Update an institution
 * POST   /institutions/:id/deactivate - Deactivate an institution
 * POST   /institutions/:id/reactivate - Reactivate an inactive institution
 * GET    /institutions       - List institutions (paginated, filterable)
 * GET    /institutions/:id   - Get a single institution
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { InstitutionService } from './institution-service.js';
import {
  CreateInstitutionSchema,
  UpdateInstitutionSchema,
  DeactivateInstitutionSchema,
  ReactivateInstitutionSchema,
  InstitutionListQuerySchema,
  InstitutionParamsSchema,
  type CreateInstitutionInput,
  type UpdateInstitutionInput,
  type DeactivateInstitutionInput,
  type ReactivateInstitutionInput,
  type InstitutionListQuery,
  type InstitutionParams,
} from './schemas.js';

/**
 * Options for registering institution routes.
 */
export interface InstitutionRoutesOptions {
  institutionService: InstitutionService;
  /** Route prefix (default: '/institutions') */
  prefix?: string;
}

/**
 * Formats an institution entity to the API response shape.
 */
interface StatusAuditRecorder {
  recordAudit: (input: {
    tenantId: string;
    entityType: string;
    entityId: string;
    operation: 'UPDATE';
    userId: string;
    userName: string;
    ipAddress: string;
    beforeValues: Record<string, unknown>;
    afterValues: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }) => Promise<unknown>;
}

/**
 * Persist actor, reason, and before/after status when the gateway audit
 * service is decorated. Deactivate does not emit an outbox or plugin event,
 * so reactivate does not either. A missing decorator (package route tests)
 * skips the write. Audit failure is logged and does not hide the status change.
 */
async function recordInstitutionStatusAudit(
  fastify: FastifyInstance,
  request: FastifyRequest,
  input: {
    tenantId: string;
    institutionId: string;
    action: 'institution.deactivate' | 'institution.reactivate';
    reason: string;
    beforeStatus: string;
    afterStatus: string;
    beforeReason: string | null;
    afterReason: string | null;
  },
): Promise<void> {
  const audit = (fastify as FastifyInstance & { auditService?: StatusAuditRecorder }).auditService;
  if (!audit?.recordAudit) return;

  const user = (
    request as FastifyRequest & {
      user?: { sub?: string; displayName?: string; email?: string };
    }
  ).user;
  if (!user?.sub) return;

  try {
    await audit.recordAudit({
      tenantId: input.tenantId,
      entityType: 'institution',
      entityId: input.institutionId,
      operation: 'UPDATE',
      userId: user.sub,
      userName: user.displayName ?? user.email ?? user.sub,
      ipAddress: request.ip || '0.0.0.0',
      beforeValues: {
        status: input.beforeStatus,
        deactivationReason: input.beforeReason,
      },
      afterValues: {
        status: input.afterStatus,
        deactivationReason: input.afterReason,
        reason: input.reason,
      },
      metadata: {
        action: input.action,
        reason: input.reason,
        actorId: user.sub,
      },
    });
  } catch (error: unknown) {
    request.log.error({ err: error, action: input.action }, 'institution status audit failed');
  }
}

function formatInstitutionResponse(entity: {
  id: string;
  name: string;
  code: string;
  areaId: string;
  typeId: string;
  sectorId: string;
  ownershipId: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  deactivationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    name: entity.name,
    code: entity.code,
    areaId: entity.areaId,
    typeId: entity.typeId,
    sectorId: entity.sectorId,
    ownershipId: entity.ownershipId,
    status: entity.status,
    latitude: entity.latitude,
    longitude: entity.longitude,
    address: entity.address,
    contactPhone: entity.contactPhone,
    contactEmail: entity.contactEmail,
    deactivationReason: entity.deactivationReason,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register institution routes on a Fastify instance.
 */
export async function registerInstitutionRoutes(
  fastify: FastifyInstance,
  options: InstitutionRoutesOptions,
): Promise<void> {
  const { institutionService, prefix = '/institutions' } = options;

  /**
   * POST /institutions
   * Create a new institution.
   */
  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateInstitutionInput }>,
      reply: FastifyReply,
    ) {
      // Validate request body
      const result = validate(CreateInstitutionSchema, request.body);
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
        const institution = await institutionService.create(tenantId, result.data);
        return reply.status(201).send(formatInstitutionResponse(institution));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /institutions/:id
   * Update an existing institution.
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: InstitutionParams; Body: UpdateInstitutionInput }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(InstitutionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid institution ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      // Validate body
      const bodyResult = validate(UpdateInstitutionSchema, request.body);
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
        const institution = await institutionService.update(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatInstitutionResponse(institution));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /institutions/:id/deactivate
   * Deactivate an institution (set status to INACTIVE).
   */
  fastify.post(
    `${prefix}/:id/deactivate`,
    async function deactivateHandler(
      request: FastifyRequest<{ Params: InstitutionParams; Body: DeactivateInstitutionInput }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(InstitutionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid institution ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      // Validate body
      const bodyResult = validate(DeactivateInstitutionSchema, request.body);
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
        const before = await institutionService.getById(tenantId, paramsResult.data.id);
        const institution = await institutionService.deactivate(
          tenantId,
          paramsResult.data.id,
          bodyResult.data.reason,
        );
        await recordInstitutionStatusAudit(fastify, request, {
          tenantId,
          institutionId: institution.id,
          action: 'institution.deactivate',
          reason: bodyResult.data.reason,
          beforeStatus: before.status,
          afterStatus: institution.status,
          beforeReason: before.deactivationReason,
          afterReason: institution.deactivationReason,
        });
        return reply.status(200).send(formatInstitutionResponse(institution));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /institutions/:id/reactivate
   * Reactivate an inactive institution (set status to ACTIVE).
   * Authorized as institution:update, same as deactivate.
   */
  fastify.post(
    `${prefix}/:id/reactivate`,
    async function reactivateHandler(
      request: FastifyRequest<{ Params: InstitutionParams; Body: ReactivateInstitutionInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(InstitutionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid institution ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(ReactivateInstitutionSchema, request.body);
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
        const before = await institutionService.getById(tenantId, paramsResult.data.id);
        const institution = await institutionService.reactivate(tenantId, paramsResult.data.id);
        await recordInstitutionStatusAudit(fastify, request, {
          tenantId,
          institutionId: institution.id,
          action: 'institution.reactivate',
          reason: bodyResult.data.reason,
          beforeStatus: before.status,
          afterStatus: institution.status,
          beforeReason: before.deactivationReason,
          afterReason: institution.deactivationReason,
        });
        return reply.status(200).send(formatInstitutionResponse(institution));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /institutions
   * List institutions with pagination and filtering.
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: InstitutionListQuery }>,
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

      // Parse query with defaults (query params come as strings)
      const query = request.query as InstitutionListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'name';
      const sortOrder = (query.sortOrder ?? 'asc') as 'asc' | 'desc';

      const result = await institutionService.list(
        tenantId,
        {
          areaId: query.areaId,
          status: query.status as 'ACTIVE' | 'INACTIVE' | undefined,
          search: query.search,
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map(formatInstitutionResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /institutions/:id
   * Get a single institution by ID.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: InstitutionParams }>,
      reply: FastifyReply,
    ) {
      // Validate params
      const paramsResult = validate(InstitutionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid institution ID',
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
        const institution = await institutionService.getById(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatInstitutionResponse(institution));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
