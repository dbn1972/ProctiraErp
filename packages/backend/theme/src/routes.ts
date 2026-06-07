/**
 * Theme Routes
 *
 * POST   /themes                          - Create a new theme
 * GET    /themes                          - List themes for the current tenant
 * GET    /themes/:themeId                 - Get a theme by ID
 * PUT    /themes/:themeId                 - Update a theme
 * POST   /themes/:themeId/publish         - Publish a theme (creates revision)
 * POST   /themes/:themeId/rollback        - Rollback to a previous revision
 * GET    /themes/:themeId/preview         - Preview theme with accessibility check
 * GET    /themes/:themeId/revisions       - List revisions for a theme
 * GET    /themes/tokens                   - Get effective tokens for the tenant
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { ThemeService } from './theme-service.js';
import type { ThemeEntity, ThemeRevisionEntity } from './theme-repository.js';
import {
  CreateThemeSchema,
  UpdateThemeSchema,
  PublishThemeSchema,
  RollbackThemeSchema,
  ThemeParamsSchema,
  ThemeListQuerySchema,
  type CreateThemeInput,
  type UpdateThemeInput,
  type PublishThemeInput,
  type RollbackThemeInput,
  type ThemeParams,
  type ThemeListQuery,
} from './schemas.js';

/**
 * Options for registering theme routes.
 */
export interface ThemeRoutesOptions {
  themeService: ThemeService;
  /** Route prefix (default: '/themes') */
  prefix?: string;
}

/**
 * Format a theme entity for API response.
 */
function formatThemeResponse(entity: ThemeEntity) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    description: entity.description,
    level: entity.level,
    portalId: entity.portalId,
    status: entity.status,
    tokens: entity.tokens,
    assets: entity.assets,
    currentRevision: entity.currentRevision,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format a revision entity for API response.
 */
function formatRevisionResponse(entity: ThemeRevisionEntity) {
  return {
    id: entity.id,
    themeId: entity.themeId,
    revisionNumber: entity.revisionNumber,
    tokens: entity.tokens,
    assets: entity.assets,
    commitMessage: entity.commitMessage,
    publishedBy: entity.publishedBy,
    publishedAt: entity.publishedAt.toISOString(),
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
 * Register theme routes on a Fastify instance.
 */
export async function registerThemeRoutes(
  fastify: FastifyInstance,
  options: ThemeRoutesOptions,
): Promise<void> {
  const { themeService, prefix = '/themes' } = options;

  /**
   * POST /themes
   * Create a new theme.
   */
  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateThemeInput }>,
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

      const result = validate(CreateThemeSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const theme = await themeService.create(tenantId, result.data);
        return reply.status(201).send(formatThemeResponse(theme));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /themes
   * List themes for the current tenant.
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: ThemeListQuery }>,
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

      const query = request.query as ThemeListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await themeService.list(
        tenantId,
        { level: query.level, status: query.status },
        page,
        pageSize,
      );

      return reply.status(200).send({
        data: result.data.map(formatThemeResponse),
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
   * GET /themes/tokens
   * Get effective tokens for the current tenant (with inheritance resolution).
   */
  fastify.get(
    `${prefix}/tokens`,
    async function getTokensHandler(
      request: FastifyRequest<{ Querystring: { portalId?: string } }>,
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

      const portalId = (request.query as { portalId?: string }).portalId;

      try {
        const tokens = await themeService.getTokens(tenantId, portalId);
        return reply.status(200).send({ tokens });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /themes/:themeId
   * Get a single theme by ID.
   */
  fastify.get(
    `${prefix}/:themeId`,
    async function getHandler(
      request: FastifyRequest<{ Params: ThemeParams }>,
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

      const paramsResult = validate(ThemeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid theme ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const theme = await themeService.getById(tenantId, paramsResult.data.themeId);
        return reply.status(200).send(formatThemeResponse(theme));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /themes/:themeId
   * Update a theme.
   */
  fastify.put(
    `${prefix}/:themeId`,
    async function updateHandler(
      request: FastifyRequest<{ Params: ThemeParams; Body: UpdateThemeInput }>,
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

      const paramsResult = validate(ThemeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid theme ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateThemeSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const theme = await themeService.update(tenantId, paramsResult.data.themeId, bodyResult.data);
        return reply.status(200).send(formatThemeResponse(theme));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /themes/:themeId/publish
   * Publish a theme, creating a versioned revision.
   */
  fastify.post(
    `${prefix}/:themeId/publish`,
    async function publishHandler(
      request: FastifyRequest<{ Params: ThemeParams; Body: PublishThemeInput }>,
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

      const paramsResult = validate(ThemeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid theme ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(PublishThemeSchema, request.body ?? {});
      const actor = getActor(request);
      const commitMessage = bodyResult.success ? bodyResult.data.commitMessage : undefined;

      try {
        const revision = await themeService.publish(
          tenantId,
          paramsResult.data.themeId,
          { commitMessage },
          actor,
        );
        return reply.status(200).send(formatRevisionResponse(revision));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /themes/:themeId/rollback
   * Rollback a theme to a previous revision.
   */
  fastify.post(
    `${prefix}/:themeId/rollback`,
    async function rollbackHandler(
      request: FastifyRequest<{ Params: ThemeParams; Body: RollbackThemeInput }>,
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

      const paramsResult = validate(ThemeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid theme ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(RollbackThemeSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const theme = await themeService.rollback(
          tenantId,
          paramsResult.data.themeId,
          bodyResult.data,
        );
        return reply.status(200).send(formatThemeResponse(theme));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /themes/:themeId/preview
   * Preview a theme with accessibility validation.
   */
  fastify.get(
    `${prefix}/:themeId/preview`,
    async function previewHandler(
      request: FastifyRequest<{ Params: ThemeParams }>,
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

      const paramsResult = validate(ThemeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid theme ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const preview = await themeService.preview(tenantId, paramsResult.data.themeId);
        return reply.status(200).send(preview);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /themes/:themeId/revisions
   * List all revisions for a theme.
   */
  fastify.get(
    `${prefix}/:themeId/revisions`,
    async function listRevisionsHandler(
      request: FastifyRequest<{ Params: ThemeParams }>,
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

      const paramsResult = validate(ThemeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid theme ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const revisions = await themeService.listRevisions(tenantId, paramsResult.data.themeId);
        return reply.status(200).send({
          data: revisions.map(formatRevisionResponse),
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
