/**
 * Infrastructure Hierarchy Routes
 *
 * CRUD routes for land, buildings, floors, and rooms in parent-child hierarchy.
 * Hierarchy: Land → Building → Floor → Room
 *
 * Routes:
 * - POST   /infrastructure/lands                              - Create land
 * - GET    /infrastructure/lands?institutionId=               - List lands for institution
 * - GET    /infrastructure/:id                                - Get infrastructure item by ID
 * - PUT    /infrastructure/:id                                - Update infrastructure item
 * - DELETE /infrastructure/:id                                - Delete infrastructure item
 * - POST   /infrastructure/buildings                          - Create building (under land)
 * - GET    /infrastructure/buildings?landId=                   - List buildings under land
 * - POST   /infrastructure/floors                             - Create floor (under building)
 * - GET    /infrastructure/floors?buildingId=                  - List floors under building
 * - POST   /infrastructure/rooms                              - Create room (under floor)
 * - GET    /infrastructure/rooms?floorId=                      - List rooms under floor
 * - GET    /infrastructure/hierarchy/:institutionId            - Get full hierarchy tree
 * - POST   /infrastructure/condition-options                   - Add condition option
 * - GET    /infrastructure/condition-options                   - List condition options
 * - DELETE /infrastructure/condition-options/:id               - Delete condition option
 *
 * @module infrastructure/routes
 * @requirements 5.6
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { InfrastructureService } from './service.js';
import {
  CreateLandSchema,
  CreateBuildingSchema,
  CreateFloorSchema,
  CreateRoomSchema,
  UpdateInfrastructureSchema,
  InfrastructureParamsSchema,
  InstitutionScopeParamsSchema,
  CreateConditionOptionSchema,
  type CreateLandInput,
  type CreateBuildingInput,
  type CreateFloorInput,
  type CreateRoomInput,
  type UpdateInfrastructureInput,
  type InfrastructureParams,
  type InstitutionScopeParams,
  type InfrastructureListQuery,
} from './schemas.js';

/**
 * Options for registering infrastructure routes.
 */
export interface InfrastructureRoutesOptions {
  infrastructureService: InfrastructureService;
  /** Route prefix (default: '/infrastructure') */
  prefix?: string;
}

function requireTenant(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (!tenantId) {
    reply.status(400).send({
      code: 'TENANT_REQUIRED',
      message: 'Tenant context is required',
      statusCode: 400,
    });
    return undefined;
  }
  return tenantId;
}

/**
 * Extracts pagination options from query parameters with defaults.
 */
function getPaginationOptions(query: Partial<InfrastructureListQuery>) {
  return {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    sortBy: query.sortBy ?? 'name',
    sortOrder: (query.sortOrder ?? 'asc') as 'asc' | 'desc',
  };
}

/**
 * Register infrastructure hierarchy routes on a Fastify instance.
 */
export async function registerInfrastructureRoutes(
  fastify: FastifyInstance,
  options: InfrastructureRoutesOptions,
): Promise<void> {
  const { infrastructureService, prefix = '/infrastructure' } = options;

  // ─── Land Routes ─────────────────────────────────────────────────────────────

  /**
   * POST /infrastructure/lands
   * Create a new land record (top-level infrastructure).
   */
  fastify.post(
    `${prefix}/lands`,
    async function createLandHandler(
      request: FastifyRequest<{ Body: CreateLandInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateLandSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        const land = await infrastructureService.createLand(tenantId, result.data);
        return reply.status(201).send(land);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /infrastructure/lands?institutionId=
   * List lands for an institution (paginated).
   */
  fastify.get(
    `${prefix}/lands`,
    async function listLandsHandler(
      request: FastifyRequest<{ Querystring: InfrastructureListQuery & { institutionId: string } }>,
      reply: FastifyReply,
    ) {
      const institutionId = request.query.institutionId;
      if (!institutionId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'institutionId query parameter is required',
          statusCode: 400,
        });
      }

      const paramsResult = validate(InstitutionScopeParamsSchema, { institutionId });
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid institutionId',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      const paginationOptions = getPaginationOptions(request.query);
      const result = await infrastructureService.listLands(tenantId, institutionId, paginationOptions);
      return reply.status(200).send(result);
    },
  );

  // ─── Building Routes ─────────────────────────────────────────────────────────

  /**
   * POST /infrastructure/buildings
   * Create a new building (child of land).
   */
  fastify.post(
    `${prefix}/buildings`,
    async function createBuildingHandler(
      request: FastifyRequest<{ Body: CreateBuildingInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateBuildingSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        const building = await infrastructureService.createBuilding(tenantId, result.data);
        return reply.status(201).send(building);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /infrastructure/buildings?landId=
   * List buildings under a specific land (paginated).
   */
  fastify.get(
    `${prefix}/buildings`,
    async function listBuildingsHandler(
      request: FastifyRequest<{ Querystring: InfrastructureListQuery & { landId: string } }>,
      reply: FastifyReply,
    ) {
      const landId = request.query.landId;
      if (!landId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'landId query parameter is required',
          statusCode: 400,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        const paginationOptions = getPaginationOptions(request.query);
        const result = await infrastructureService.listBuildings(tenantId, landId, paginationOptions);
        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Floor Routes ────────────────────────────────────────────────────────────

  /**
   * POST /infrastructure/floors
   * Create a new floor (child of building).
   */
  fastify.post(
    `${prefix}/floors`,
    async function createFloorHandler(
      request: FastifyRequest<{ Body: CreateFloorInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateFloorSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        const floor = await infrastructureService.createFloor(tenantId, result.data);
        return reply.status(201).send(floor);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /infrastructure/floors?buildingId=
   * List floors under a specific building (paginated).
   */
  fastify.get(
    `${prefix}/floors`,
    async function listFloorsHandler(
      request: FastifyRequest<{ Querystring: InfrastructureListQuery & { buildingId: string } }>,
      reply: FastifyReply,
    ) {
      const buildingId = request.query.buildingId;
      if (!buildingId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'buildingId query parameter is required',
          statusCode: 400,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        const paginationOptions = getPaginationOptions(request.query);
        const result = await infrastructureService.listFloors(tenantId, buildingId, paginationOptions);
        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Room Routes ─────────────────────────────────────────────────────────────

  /**
   * POST /infrastructure/rooms
   * Create a new room (child of floor).
   */
  fastify.post(
    `${prefix}/rooms`,
    async function createRoomHandler(
      request: FastifyRequest<{ Body: CreateRoomInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateRoomSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        const room = await infrastructureService.createRoom(tenantId, result.data);
        return reply.status(201).send(room);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /infrastructure/rooms?floorId=
   * List rooms under a specific floor (paginated).
   */
  fastify.get(
    `${prefix}/rooms`,
    async function listRoomsHandler(
      request: FastifyRequest<{ Querystring: InfrastructureListQuery & { floorId: string } }>,
      reply: FastifyReply,
    ) {
      const floorId = request.query.floorId;
      if (!floorId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'floorId query parameter is required',
          statusCode: 400,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        const paginationOptions = getPaginationOptions(request.query);
        const result = await infrastructureService.listRooms(tenantId, floorId, paginationOptions);
        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Shared Item Routes ──────────────────────────────────────────────────────

  /**
   * GET /infrastructure/:id
   * Get a single infrastructure item by ID.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getByIdHandler(
      request: FastifyRequest<{ Params: InfrastructureParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(InfrastructureParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid infrastructure ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        const item = await infrastructureService.getById(tenantId, paramsResult.data.id);
        return reply.status(200).send(item);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /infrastructure/:id
   * Update an infrastructure item.
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: InfrastructureParams; Body: UpdateInfrastructureInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(InfrastructureParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid infrastructure ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateInfrastructureSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        const updated = await infrastructureService.update(tenantId, paramsResult.data.id, bodyResult.data);
        return reply.status(200).send(updated);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /infrastructure/:id
   * Delete an infrastructure item (fails if it has children).
   */
  fastify.delete(
    `${prefix}/:id`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: InfrastructureParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(InfrastructureParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid infrastructure ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        await infrastructureService.delete(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Hierarchy Tree Route ────────────────────────────────────────────────────

  /**
   * GET /infrastructure/hierarchy/:institutionId
   * Get the full infrastructure hierarchy tree for an institution.
   */
  fastify.get(
    `${prefix}/hierarchy/:institutionId`,
    async function getHierarchyHandler(
      request: FastifyRequest<{ Params: InstitutionScopeParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(InstitutionScopeParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid institution ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      const hierarchy = await infrastructureService.getHierarchy(
        tenantId,
        paramsResult.data.institutionId,
      );
      return reply.status(200).send(hierarchy);
    },
  );

  // ─── Condition Options Routes ────────────────────────────────────────────────

  /**
   * POST /infrastructure/condition-options
   * Add a configurable condition option.
   */
  fastify.post(
    `${prefix}/condition-options`,
    async function createConditionOptionHandler(
      request: FastifyRequest<{ Body: { name: string; description?: string } }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateConditionOptionSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        const option = await infrastructureService.addConditionOption(
          tenantId,
          result.data.name,
          result.data.description,
        );
        return reply.status(201).send(option);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /infrastructure/condition-options
   * List all configurable condition options.
   */
  fastify.get(
    `${prefix}/condition-options`,
    async function listConditionOptionsHandler(
      request: FastifyRequest,
      reply: FastifyReply,
    ) {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      const options = await infrastructureService.listConditionOptions(tenantId);
      return reply.status(200).send(options);
    },
  );

  /**
   * DELETE /infrastructure/condition-options/:id
   * Delete a condition option.
   */
  fastify.delete(
    `${prefix}/condition-options/:id`,
    async function deleteConditionOptionHandler(
      request: FastifyRequest<{ Params: InfrastructureParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(InfrastructureParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid condition option ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;

      try {
        await infrastructureService.deleteConditionOption(tenantId, paramsResult.data.id);
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
