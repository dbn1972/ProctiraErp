/**
 * Plugin Routes
 *
 * POST   /plugins                          - Register a new plugin
 * GET    /plugins                          - List registered plugins
 * GET    /plugins/:pluginId                - Get a plugin by ID
 * POST   /plugins/install                  - Install a plugin for the current tenant
 * GET    /plugins/installations            - List installations for the current tenant
 * GET    /plugins/installations/:installId - Get a specific installation
 * POST   /plugins/installations/:installId/enable   - Enable an installed plugin
 * POST   /plugins/installations/:installId/disable  - Disable an installed plugin
 * POST   /plugins/installations/:installId/uninstall - Uninstall a plugin
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { PluginService } from './plugin-service.js';
import {
  RegisterPluginSchema,
  InstallPluginSchema,
  PluginParamsSchema,
  PluginInstallParamsSchema,
  PluginListQuerySchema,
  UninstallPluginSchema,
  type RegisterPluginInput,
  type InstallPluginInput,
  type PluginParams,
  type PluginInstallParams,
  type PluginListQuery,
  type UninstallPluginInput,
} from './schemas.js';

/**
 * Options for registering plugin routes.
 */
export interface PluginRoutesOptions {
  pluginService: PluginService;
  /** Route prefix (default: '/plugins') */
  prefix?: string;
}

/**
 * Format a plugin entity for API response.
 */
function formatPluginResponse(entity: {
  id: string;
  name: string;
  owner: string;
  version: string;
  description: string | null;
  category: string | null;
  status: string;
  supportedProductVersions: string;
  requiredPermissions: string[];
  requiredExtensionPoints: string[];
  tenantScopeBehavior: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    name: entity.name,
    owner: entity.owner,
    version: entity.version,
    description: entity.description,
    category: entity.category,
    status: entity.status,
    supportedProductVersions: entity.supportedProductVersions,
    requiredPermissions: entity.requiredPermissions,
    requiredExtensionPoints: entity.requiredExtensionPoints,
    tenantScopeBehavior: entity.tenantScopeBehavior,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format an install entity for API response.
 */
function formatInstallResponse(entity: {
  id: string;
  pluginId: string;
  tenantId: string;
  status: string;
  consentedPermissions: string[];
  configuration: Record<string, unknown> | null;
  installedAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    pluginId: entity.pluginId,
    tenantId: entity.tenantId,
    status: entity.status,
    consentedPermissions: entity.consentedPermissions,
    configuration: entity.configuration,
    installedAt: entity.installedAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Extract tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | undefined {
  return (request as FastifyRequest & { tenantId?: string }).tenantId;
}

/**
 * Extract actor (user ID) from request.
 */
function getActor(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string } }).user;
  return user?.sub ?? 'system';
}

/**
 * Register plugin routes on a Fastify instance.
 */
export async function registerPluginRoutes(
  fastify: FastifyInstance,
  options: PluginRoutesOptions,
): Promise<void> {
  const { pluginService, prefix = '/plugins' } = options;

  /**
   * POST /plugins
   * Register a new plugin in the registry.
   */
  fastify.post(
    prefix,
    async function registerHandler(
      request: FastifyRequest<{ Body: RegisterPluginInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(RegisterPluginSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const actor = getActor(request);

      try {
        const plugin = await pluginService.register(result.data, actor);
        return reply.status(201).send(formatPluginResponse(plugin));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /plugins
   * List registered plugins with filtering and pagination.
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: PluginListQuery }>,
      reply: FastifyReply,
    ) {
      const query = request.query as PluginListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await pluginService.list(
        { category: query.category, search: query.search },
        page,
        pageSize,
      );

      return reply.status(200).send({
        data: result.data.map(formatPluginResponse),
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
   * GET /plugins/:pluginId
   * Get a single plugin by ID.
   */
  fastify.get(
    `${prefix}/:pluginId`,
    async function getHandler(
      request: FastifyRequest<{ Params: PluginParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PluginParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid plugin ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const plugin = await pluginService.getById(paramsResult.data.pluginId);
        return reply.status(200).send(formatPluginResponse(plugin));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /plugins/install
   * Install a plugin for the current tenant.
   */
  fastify.post(
    `${prefix}/install`,
    async function installHandler(
      request: FastifyRequest<{ Body: InstallPluginInput }>,
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

      const result = validate(InstallPluginSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const actor = getActor(request);

      try {
        const install = await pluginService.install(tenantId, result.data, actor);
        return reply.status(201).send(formatInstallResponse(install));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /plugins/installations
   * List all plugin installations for the current tenant.
   */
  fastify.get(
    `${prefix}/installations`,
    async function listInstallationsHandler(
      request: FastifyRequest,
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

      const installations = await pluginService.listInstallations(tenantId);
      return reply.status(200).send({
        data: installations.map(formatInstallResponse),
      });
    },
  );

  /**
   * GET /plugins/installations/:installId
   * Get a specific plugin installation.
   */
  fastify.get(
    `${prefix}/installations/:installId`,
    async function getInstallationHandler(
      request: FastifyRequest<{ Params: PluginInstallParams }>,
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

      const paramsResult = validate(PluginInstallParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid install ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const install = await pluginService.getInstallation(tenantId, paramsResult.data.installId);
        return reply.status(200).send(formatInstallResponse(install));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /plugins/installations/:installId/enable
   * Enable an installed plugin.
   */
  fastify.post(
    `${prefix}/installations/:installId/enable`,
    async function enableHandler(
      request: FastifyRequest<{ Params: PluginInstallParams }>,
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

      const paramsResult = validate(PluginInstallParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid install ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const actor = getActor(request);

      try {
        const install = await pluginService.enable(tenantId, paramsResult.data.installId, actor);
        return reply.status(200).send(formatInstallResponse(install));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /plugins/installations/:installId/disable
   * Disable an installed plugin.
   */
  fastify.post(
    `${prefix}/installations/:installId/disable`,
    async function disableHandler(
      request: FastifyRequest<{ Params: PluginInstallParams }>,
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

      const paramsResult = validate(PluginInstallParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid install ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const actor = getActor(request);

      try {
        const install = await pluginService.disable(tenantId, paramsResult.data.installId, actor);
        return reply.status(200).send(formatInstallResponse(install));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /plugins/installations/:installId/uninstall
   * Uninstall a plugin for the current tenant.
   */
  fastify.post(
    `${prefix}/installations/:installId/uninstall`,
    async function uninstallHandler(
      request: FastifyRequest<{ Params: PluginInstallParams; Body: UninstallPluginInput }>,
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

      const paramsResult = validate(PluginInstallParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid install ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UninstallPluginSchema, request.body ?? {});
      const actor = getActor(request);
      const reason = bodyResult.success ? bodyResult.data.reason : undefined;

      try {
        const install = await pluginService.uninstall(
          tenantId,
          paramsResult.data.installId,
          actor,
          reason,
        );
        return reply.status(200).send(formatInstallResponse(install));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
