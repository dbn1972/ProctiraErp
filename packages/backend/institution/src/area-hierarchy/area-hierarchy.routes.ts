/**
 * Area Hierarchy Routes
 *
 * POST   /areas              - Create a new area hierarchy node
 * PUT    /areas/:areaId      - Update an area hierarchy node
 * POST   /areas/:areaId/move - Move an area to a new parent
 * GET    /areas/tree         - Get the full area hierarchy tree
 * GET    /areas/:areaId      - Get a single area by ID
 * GET    /areas/:areaId/descendants - Get all descendant area IDs
 * GET    /areas/:areaId/institutions - Get institutions in area (including descendants)
 *
 * Requirements: 5.2
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { AreaHierarchyService } from './area-hierarchy.service.js';
import { toIsoString } from '../date-utils.js';
import {
  CreateAreaBodySchema,
  UpdateAreaBodySchema,
  MoveAreaBodySchema,
  AreaIdParamSchema,
  AreaTreeQuerySchema,
  AreaInstitutionsQuerySchema,
  type CreateAreaBody,
  type UpdateAreaBody,
  type MoveAreaBody,
  type AreaIdParam,
  type AreaTreeQuery,
  type AreaInstitutionsQuery,
} from './area-hierarchy.schemas.js';

/**
 * Options for registering area hierarchy routes.
 */
export interface AreaHierarchyRoutesOptions {
  areaHierarchyService: AreaHierarchyService;
  /** Route prefix (default: '/areas') */
  prefix?: string;
}

/**
 * Formats a GeographicArea entity to the API response shape.
 */
function formatAreaResponse(entity: {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  level: number;
  parentId: string | null;
  path: string;
  lft: number;
  rgt: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    code: entity.code,
    level: entity.level,
    parentId: entity.parentId,
    path: entity.path,
    lft: entity.lft,
    rgt: entity.rgt,
    createdAt: toIsoString(entity.createdAt),
    updatedAt: toIsoString(entity.updatedAt),
  };
}

/**
 * Register area hierarchy routes on a Fastify instance.
 */
export async function registerAreaHierarchyRoutes(
  fastify: FastifyInstance,
  options: AreaHierarchyRoutesOptions,
): Promise<void> {
  const { areaHierarchyService, prefix = '/areas' } = options;

  /**
   * POST /areas
   * Create a new area hierarchy node.
   */
  fastify.post(
    prefix,
    async function createAreaHandler(
      request: FastifyRequest<{ Body: CreateAreaBody }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateAreaBodySchema, request.body);
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
        const area = await areaHierarchyService.create({
          tenantId,
          name: result.data.name,
          code: result.data.code,
          parentId: result.data.parentId ?? null,
        });
        return reply.status(201).send(formatAreaResponse(area));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /areas/tree
   * Get the full area hierarchy tree (optionally from a root node).
   */
  fastify.get(
    `${prefix}/tree`,
    async function getTreeHandler(
      request: FastifyRequest<{ Querystring: AreaTreeQuery }>,
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

      try {
        const query = request.query as AreaTreeQuery;
        const tree = await areaHierarchyService.getTree(tenantId, query.rootId);
        return reply.status(200).send(tree);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /areas/:areaId
   * Get a single area by ID.
   */
  fastify.get(
    `${prefix}/:areaId`,
    async function getAreaHandler(
      request: FastifyRequest<{ Params: AreaIdParam }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AreaIdParamSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid area ID',
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
        const area = await areaHierarchyService.getById(tenantId, paramsResult.data.areaId);
        return reply.status(200).send(formatAreaResponse(area));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /areas/:areaId
   * Update an area hierarchy node (name and/or code).
   */
  fastify.put(
    `${prefix}/:areaId`,
    async function updateAreaHandler(
      request: FastifyRequest<{ Params: AreaIdParam; Body: UpdateAreaBody }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AreaIdParamSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid area ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateAreaBodySchema, request.body);
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
        const area = await areaHierarchyService.update(
          tenantId,
          paramsResult.data.areaId,
          bodyResult.data,
        );
        return reply.status(200).send(formatAreaResponse(area));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /areas/:areaId/move
   * Move an area to a new parent.
   */
  fastify.post(
    `${prefix}/:areaId/move`,
    async function moveAreaHandler(
      request: FastifyRequest<{ Params: AreaIdParam; Body: MoveAreaBody }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AreaIdParamSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid area ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(MoveAreaBodySchema, request.body);
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
        const area = await areaHierarchyService.move(
          tenantId,
          paramsResult.data.areaId,
          bodyResult.data,
        );
        return reply.status(200).send(formatAreaResponse(area));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /areas/:areaId/descendants
   * Get all descendant area IDs for a given area.
   */
  fastify.get(
    `${prefix}/:areaId/descendants`,
    async function getDescendantsHandler(
      request: FastifyRequest<{ Params: AreaIdParam }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AreaIdParamSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid area ID',
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
        const descendantIds = await areaHierarchyService.getDescendantIds(
          tenantId,
          paramsResult.data.areaId,
        );
        return reply.status(200).send({ areaIds: descendantIds });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /areas/:areaId/institutions
   * Get institutions in an area and all its descendant areas (paginated).
   */
  fastify.get(
    `${prefix}/:areaId/institutions`,
    async function getInstitutionsByAreaHandler(
      request: FastifyRequest<{ Params: AreaIdParam; Querystring: AreaInstitutionsQuery }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(AreaIdParamSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid area ID',
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
        const query = request.query as AreaInstitutionsQuery;
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 20;

        const result = await areaHierarchyService.getInstitutionsByArea(
          tenantId,
          paramsResult.data.areaId,
          { page, pageSize },
        );
        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
