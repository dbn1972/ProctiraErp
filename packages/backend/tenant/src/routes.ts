/**
 * Tenant Lifecycle Routes
 *
 * Tenant CRUD:
 * POST   /tenants                          - Create a new tenant (provision)
 * GET    /tenants                          - List tenants (paginated, filterable)
 * GET    /tenants/:id                      - Get a single tenant
 * PUT    /tenants/:id                      - Update a tenant
 *
 * Lifecycle Actions:
 * POST   /tenants/:id/suspend              - Suspend a tenant
 * POST   /tenants/:id/reactivate           - Reactivate a suspended tenant
 * POST   /tenants/:id/decommission         - Decommission a tenant
 * DELETE /tenants/:id                      - Permanently delete (post-retention)
 *
 * Configuration:
 * GET    /tenants/:id/config               - Get tenant configuration
 * PUT    /tenants/:id/config               - Update tenant configuration
 *
 * Domains:
 * GET    /tenants/:id/domains              - List tenant domains
 * POST   /tenants/:id/domains              - Add a domain
 * DELETE /tenants/:id/domains/:domainId    - Remove a domain
 *
 * Usage:
 * GET    /tenants/:id/usage                - Get tenant usage dashboard
 *
 * Charter: Section 6 (Tenant Model)
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { TenantService } from './tenant-service.js';
import {
  CreateTenantSchema,
  UpdateTenantSchema,
  TenantParamsSchema,
  TenantListQuerySchema,
  SuspendTenantSchema,
  DecommissionTenantSchema,
  UpdateConfigSchema,
  AddDomainSchema,
  type CreateTenantInput,
  type UpdateTenantInput,
  type TenantParams,
  type TenantListQuery,
  type SuspendTenantInput,
  type DecommissionTenantInput,
  type UpdateConfigInput,
  type AddDomainInput,
} from './schemas.js';

/**
 * Options for registering tenant routes.
 */
export interface TenantRoutesOptions {
  tenantService: TenantService;
  /** Route prefix (default: '/tenants') */
  prefix?: string;
}

/**
 * Register tenant lifecycle routes on a Fastify instance.
 */
export async function registerTenantRoutes(
  fastify: FastifyInstance,
  options: TenantRoutesOptions,
): Promise<void> {
  const { tenantService, prefix = '/tenants' } = options;

  // ─── Tenant CRUD Routes ────────────────────────────────────────────────

  /**
   * POST /tenants
   * Create and provision a new tenant.
   */
  fastify.post(
    prefix,
    async function createTenantHandler(
      request: FastifyRequest<{ Body: CreateTenantInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateTenantSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const tenant = await tenantService.createTenant(result.data);
        return reply.status(201).send(tenantService.formatTenantResponse(tenant));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /tenants
   * List tenants with pagination and filtering.
   */
  fastify.get(
    prefix,
    async function listTenantsHandler(
      request: FastifyRequest<{ Querystring: TenantListQuery }>,
      reply: FastifyReply,
    ) {
      const query = request.query as TenantListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'createdAt';
      const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

      const result = await tenantService.listTenants(
        {
          status: query.status,
          search: query.search,
          region: query.region,
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((t) => tenantService.formatTenantResponse(t)),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /tenants/:id
   * Get a single tenant by ID.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getTenantHandler(
      request: FastifyRequest<{ Params: TenantParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const tenant = await tenantService.getTenantById(paramsResult.data.id);
        return reply.status(200).send(tenantService.formatTenantResponse(tenant));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /tenants/:id
   * Update a tenant.
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateTenantHandler(
      request: FastifyRequest<{ Params: TenantParams; Body: UpdateTenantInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateTenantSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const tenant = await tenantService.updateTenant(paramsResult.data.id, bodyResult.data);
        return reply.status(200).send(tenantService.formatTenantResponse(tenant));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Lifecycle Action Routes ───────────────────────────────────────────

  /**
   * POST /tenants/:id/suspend
   * Suspend a tenant.
   */
  fastify.post(
    `${prefix}/:id/suspend`,
    async function suspendTenantHandler(
      request: FastifyRequest<{ Params: TenantParams; Body: SuspendTenantInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(SuspendTenantSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const tenant = await tenantService.suspendTenant(paramsResult.data.id, bodyResult.data);
        return reply.status(200).send(tenantService.formatTenantResponse(tenant));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /tenants/:id/reactivate
   * Reactivate a suspended tenant.
   */
  fastify.post(
    `${prefix}/:id/reactivate`,
    async function reactivateTenantHandler(
      request: FastifyRequest<{ Params: TenantParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const tenant = await tenantService.reactivateTenant(paramsResult.data.id);
        return reply.status(200).send(tenantService.formatTenantResponse(tenant));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /tenants/:id/decommission
   * Decommission a tenant (with data retention).
   */
  fastify.post(
    `${prefix}/:id/decommission`,
    async function decommissionTenantHandler(
      request: FastifyRequest<{ Params: TenantParams; Body: DecommissionTenantInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(DecommissionTenantSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const tenant = await tenantService.decommissionTenant(paramsResult.data.id, bodyResult.data);
        return reply.status(200).send(tenantService.formatTenantResponse(tenant));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /tenants/:id
   * Permanently delete a decommissioned tenant (post-retention).
   */
  fastify.delete(
    `${prefix}/:id`,
    async function deleteTenantHandler(
      request: FastifyRequest<{ Params: TenantParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        await tenantService.deleteTenant(paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Configuration Routes ──────────────────────────────────────────────

  /**
   * GET /tenants/:id/config
   * Get tenant configuration.
   */
  fastify.get(
    `${prefix}/:id/config`,
    async function getConfigHandler(
      request: FastifyRequest<{ Params: TenantParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const config = await tenantService.getConfig(paramsResult.data.id);
        return reply.status(200).send(config);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /tenants/:id/config
   * Update tenant configuration.
   */
  fastify.put(
    `${prefix}/:id/config`,
    async function updateConfigHandler(
      request: FastifyRequest<{ Params: TenantParams; Body: UpdateConfigInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateConfigSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const tenant = await tenantService.updateConfig(paramsResult.data.id, bodyResult.data);
        return reply.status(200).send(tenant.config);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Domain Routes ─────────────────────────────────────────────────────

  /**
   * GET /tenants/:id/domains
   * List domains for a tenant.
   */
  fastify.get(
    `${prefix}/:id/domains`,
    async function listDomainsHandler(
      request: FastifyRequest<{ Params: TenantParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const domains = await tenantService.listDomains(paramsResult.data.id);
        return reply.status(200).send(
          domains.map((d) => tenantService.formatDomainResponse(d)),
        );
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /tenants/:id/domains
   * Add a domain to a tenant.
   */
  fastify.post(
    `${prefix}/:id/domains`,
    async function addDomainHandler(
      request: FastifyRequest<{ Params: TenantParams; Body: AddDomainInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(AddDomainSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const domain = await tenantService.addDomain(paramsResult.data.id, bodyResult.data);
        return reply.status(201).send(tenantService.formatDomainResponse(domain));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /tenants/:id/domains/:domainId
   * Remove a domain from a tenant.
   */
  fastify.delete(
    `${prefix}/:id/domains/:domainId`,
    async function removeDomainHandler(
      request: FastifyRequest<{ Params: TenantParams & { domainId: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const domainId = (request.params as { domainId?: string }).domainId;
      if (!domainId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Domain ID is required',
          statusCode: 400,
          errors: [],
        });
      }

      try {
        await tenantService.removeDomain(paramsResult.data.id, domainId);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Usage Routes ──────────────────────────────────────────────────────

  /**
   * GET /tenants/:id/usage
   * Get tenant usage dashboard (storage, users, API calls).
   */
  fastify.get(
    `${prefix}/:id/usage`,
    async function getUsageHandler(
      request: FastifyRequest<{ Params: TenantParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TenantParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid tenant ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const usage = await tenantService.getUsage(paramsResult.data.id);
        return reply.status(200).send(usage);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
