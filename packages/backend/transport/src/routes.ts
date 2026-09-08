/**
 * Transport Routes
 *
 * Routes:
 *   POST   /transport/routes              - Create a transport route
 *   PUT    /transport/routes/:id          - Update a transport route
 *   GET    /transport/routes              - List transport routes
 *   GET    /transport/routes/:id          - Get a transport route
 *   DELETE /transport/routes/:id          - Delete a transport route
 *
 * Stops:
 *   POST   /transport/stops               - Create a route stop
 *   PUT    /transport/stops/:id           - Update a route stop
 *   GET    /transport/routes/:routeId/stops - List stops for a route
 *   DELETE /transport/stops/:id           - Delete a route stop
 *
 * Vehicles:
 *   POST   /transport/vehicles            - Create a vehicle
 *   PUT    /transport/vehicles/:id        - Update a vehicle
 *   GET    /transport/vehicles            - List vehicles
 *   GET    /transport/vehicles/:id        - Get a vehicle
 *   DELETE /transport/vehicles/:id        - Delete a vehicle
 *
 * Driver Assignments:
 *   POST   /transport/driver-assignments          - Create a driver assignment
 *   PUT    /transport/driver-assignments/:id      - Update a driver assignment
 *   GET    /transport/driver-assignments          - List driver assignments
 *
 * Student Assignments:
 *   POST   /transport/student-assignments         - Assign student to route
 *   PUT    /transport/student-assignments/:id     - Update student assignment
 *   GET    /transport/student-assignments         - List student assignments
 *
 * Requirements: 1.2 (Transport_Module)
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  CreateTransportRouteSchema,
  UpdateTransportRouteSchema,
  CreateRouteStopSchema,
  UpdateRouteStopSchema,
  CreateVehicleSchema,
  UpdateVehicleSchema,
  CreateDriverAssignmentSchema,
  UpdateDriverAssignmentSchema,
  CreateStudentAssignmentSchema,
  UpdateStudentAssignmentSchema,
  TransportParamsSchema,
  RouteParamsSchema,
  type CreateTransportRouteInput,
  type UpdateTransportRouteInput,
  type CreateRouteStopInput,
  type UpdateRouteStopInput,
  type CreateVehicleInput,
  type UpdateVehicleInput,
  type CreateDriverAssignmentInput,
  type UpdateDriverAssignmentInput,
  type CreateStudentAssignmentInput,
  type UpdateStudentAssignmentInput,
  type TransportParams,
  type RouteParams,
  type TransportListQuery,
  RecordGpsPingSchema,
  VehicleParamsSchema,
  RecordBusAttendanceSchema,
  type RecordGpsPingInput,
  type VehicleParams,
  type RecordBusAttendanceInput,
} from './schemas.js';
import type { RouteStatus, VehicleStatus } from './transport-repository.js';
import type { TransportService } from './transport-service.js';

/**
 * Options for registering transport routes.
 */
export interface TransportRoutesOptions {
  transportService: TransportService;
  /** Route prefix (default: '/transport') */
  prefix?: string;
}

/**
 * Helper to extract tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/**
 * Register transport routes on a Fastify instance.
 */
export async function registerTransportRoutes(
  fastify: FastifyInstance,
  options: TransportRoutesOptions,
): Promise<void> {
  const { transportService, prefix = '/transport' } = options;

  // ─── Route Routes ──────────────────────────────────────────────────────

  /**
   * POST /transport/routes - Create a transport route
   */
  fastify.post(
    `${prefix}/routes`,
    async function createRouteHandler(
      request: FastifyRequest<{ Body: CreateTransportRouteInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateTransportRouteSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const route = await transportService.createRoute(tenantId, result.data);
        return reply.status(201).send({
          ...route,
          createdAt: route.createdAt.toISOString(),
          updatedAt: route.updatedAt.toISOString(),
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
   * PUT /transport/routes/:id - Update a transport route
   */
  fastify.put(
    `${prefix}/routes/:id`,
    async function updateRouteHandler(
      request: FastifyRequest<{ Params: TransportParams; Body: UpdateTransportRouteInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TransportParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateTransportRouteSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const route = await transportService.updateRoute(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send({
          ...route,
          createdAt: route.createdAt.toISOString(),
          updatedAt: route.updatedAt.toISOString(),
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
   * GET /transport/routes - List transport routes
   */
  fastify.get(
    `${prefix}/routes`,
    async function listRoutesHandler(
      request: FastifyRequest<{ Querystring: TransportListQuery & { institutionId?: string } }>,
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

      const query = request.query;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'createdAt';
      const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

      const result = await transportService.listRoutes(
        tenantId,
        {
          status: query.status as RouteStatus | undefined,
          institutionId: query.institutionId,
          search: query.search,
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /transport/routes/:id - Get a transport route
   */
  fastify.get(
    `${prefix}/routes/:id`,
    async function getRouteHandler(
      request: FastifyRequest<{ Params: TransportParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TransportParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const route = await transportService.getRouteById(tenantId, paramsResult.data.id);
        return reply.status(200).send({
          ...route,
          createdAt: route.createdAt.toISOString(),
          updatedAt: route.updatedAt.toISOString(),
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
   * DELETE /transport/routes/:id - Delete a transport route
   */
  fastify.delete(
    `${prefix}/routes/:id`,
    async function deleteRouteHandler(
      request: FastifyRequest<{ Params: TransportParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TransportParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        await transportService.deleteRoute(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Stop Routes ───────────────────────────────────────────────────────

  /**
   * POST /transport/stops - Create a route stop
   */
  fastify.post(
    `${prefix}/stops`,
    async function createStopHandler(
      request: FastifyRequest<{ Body: CreateRouteStopInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateRouteStopSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const stop = await transportService.createStop(tenantId, result.data);
        return reply.status(201).send({
          ...stop,
          createdAt: stop.createdAt.toISOString(),
          updatedAt: stop.updatedAt.toISOString(),
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
   * PUT /transport/stops/:id - Update a route stop
   */
  fastify.put(
    `${prefix}/stops/:id`,
    async function updateStopHandler(
      request: FastifyRequest<{ Params: TransportParams; Body: UpdateRouteStopInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TransportParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateRouteStopSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const stop = await transportService.updateStop(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send({
          ...stop,
          createdAt: stop.createdAt.toISOString(),
          updatedAt: stop.updatedAt.toISOString(),
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
   * GET /transport/routes/:routeId/stops - List stops for a route
   */
  fastify.get(
    `${prefix}/routes/:routeId/stops`,
    async function listStopsHandler(
      request: FastifyRequest<{ Params: RouteParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(RouteParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid route ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const stops = await transportService.listStopsByRoute(tenantId, paramsResult.data.routeId);
        return reply.status(200).send({
          data: stops.map((s) => ({
            ...s,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
          })),
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
   * DELETE /transport/stops/:id - Delete a route stop
   */
  fastify.delete(
    `${prefix}/stops/:id`,
    async function deleteStopHandler(
      request: FastifyRequest<{ Params: TransportParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TransportParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        await transportService.deleteStop(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Vehicle Routes ────────────────────────────────────────────────────

  /**
   * POST /transport/vehicles - Create a vehicle
   */
  fastify.post(
    `${prefix}/vehicles`,
    async function createVehicleHandler(
      request: FastifyRequest<{ Body: CreateVehicleInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateVehicleSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const vehicle = await transportService.createVehicle(tenantId, result.data);
        return reply.status(201).send({
          ...vehicle,
          createdAt: vehicle.createdAt.toISOString(),
          updatedAt: vehicle.updatedAt.toISOString(),
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
   * PUT /transport/vehicles/:id - Update a vehicle
   */
  fastify.put(
    `${prefix}/vehicles/:id`,
    async function updateVehicleHandler(
      request: FastifyRequest<{ Params: TransportParams; Body: UpdateVehicleInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TransportParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateVehicleSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const vehicle = await transportService.updateVehicle(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send({
          ...vehicle,
          createdAt: vehicle.createdAt.toISOString(),
          updatedAt: vehicle.updatedAt.toISOString(),
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
   * GET /transport/vehicles - List vehicles
   */
  fastify.get(
    `${prefix}/vehicles`,
    async function listVehiclesHandler(
      request: FastifyRequest<{ Querystring: TransportListQuery }>,
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

      const query = request.query;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'createdAt';
      const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

      const result = await transportService.listVehicles(
        tenantId,
        {
          status: query.status as VehicleStatus | undefined,
          search: query.search,
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((v) => ({
          ...v,
          createdAt: v.createdAt.toISOString(),
          updatedAt: v.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /transport/vehicles/:id - Get a vehicle
   */
  fastify.get(
    `${prefix}/vehicles/:id`,
    async function getVehicleHandler(
      request: FastifyRequest<{ Params: TransportParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TransportParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const vehicle = await transportService.getVehicleById(tenantId, paramsResult.data.id);
        return reply.status(200).send({
          ...vehicle,
          createdAt: vehicle.createdAt.toISOString(),
          updatedAt: vehicle.updatedAt.toISOString(),
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
   * DELETE /transport/vehicles/:id - Delete a vehicle
   */
  fastify.delete(
    `${prefix}/vehicles/:id`,
    async function deleteVehicleHandler(
      request: FastifyRequest<{ Params: TransportParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TransportParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        await transportService.deleteVehicle(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Driver Assignment Routes ──────────────────────────────────────────

  /**
   * POST /transport/driver-assignments - Create a driver assignment
   */
  fastify.post(
    `${prefix}/driver-assignments`,
    async function createDriverAssignmentHandler(
      request: FastifyRequest<{ Body: CreateDriverAssignmentInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateDriverAssignmentSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const assignment = await transportService.createDriverAssignment(tenantId, result.data);
        return reply.status(201).send({
          ...assignment,
          createdAt: assignment.createdAt.toISOString(),
          updatedAt: assignment.updatedAt.toISOString(),
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
   * PUT /transport/driver-assignments/:id - Update a driver assignment
   */
  fastify.put(
    `${prefix}/driver-assignments/:id`,
    async function updateDriverAssignmentHandler(
      request: FastifyRequest<{ Params: TransportParams; Body: UpdateDriverAssignmentInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TransportParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateDriverAssignmentSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const assignment = await transportService.updateDriverAssignment(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send({
          ...assignment,
          createdAt: assignment.createdAt.toISOString(),
          updatedAt: assignment.updatedAt.toISOString(),
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
   * GET /transport/driver-assignments - List driver assignments
   */
  fastify.get(
    `${prefix}/driver-assignments`,
    async function listDriverAssignmentsHandler(
      request: FastifyRequest<{
        Querystring: TransportListQuery & {
          vehicleId?: string;
          driverId?: string;
          routeId?: string;
          isActive?: string;
        };
      }>,
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

      const query = request.query;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'createdAt';
      const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

      const isActive =
        query.isActive === 'true' ? true : query.isActive === 'false' ? false : undefined;

      const result = await transportService.listDriverAssignments(
        tenantId,
        { vehicleId: query.vehicleId, driverId: query.driverId, routeId: query.routeId, isActive },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    },
  );

  // ─── Student Assignment Routes ─────────────────────────────────────────

  /**
   * POST /transport/student-assignments - Assign student to route
   */
  fastify.post(
    `${prefix}/student-assignments`,
    async function createStudentAssignmentHandler(
      request: FastifyRequest<{ Body: CreateStudentAssignmentInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateStudentAssignmentSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const assignment = await transportService.createStudentAssignment(tenantId, result.data);
        return reply.status(201).send({
          ...assignment,
          createdAt: assignment.createdAt.toISOString(),
          updatedAt: assignment.updatedAt.toISOString(),
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
   * PUT /transport/student-assignments/:id - Update student assignment
   */
  fastify.put(
    `${prefix}/student-assignments/:id`,
    async function updateStudentAssignmentHandler(
      request: FastifyRequest<{ Params: TransportParams; Body: UpdateStudentAssignmentInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TransportParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateStudentAssignmentSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const assignment = await transportService.updateStudentAssignment(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send({
          ...assignment,
          createdAt: assignment.createdAt.toISOString(),
          updatedAt: assignment.updatedAt.toISOString(),
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
   * GET /transport/student-assignments - List student assignments
   */
  fastify.get(
    `${prefix}/student-assignments`,
    async function listStudentAssignmentsHandler(
      request: FastifyRequest<{
        Querystring: TransportListQuery & {
          studentId?: string;
          routeId?: string;
          stopId?: string;
          isActive?: string;
        };
      }>,
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

      const query = request.query;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'createdAt';
      const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

      const isActive =
        query.isActive === 'true' ? true : query.isActive === 'false' ? false : undefined;

      const result = await transportService.listStudentAssignments(
        tenantId,
        { studentId: query.studentId, routeId: query.routeId, stopId: query.stopId, isActive },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    },
  );

  // ─── GPS / attendance-on-bus stubs (G-602) ───────────────────────────────

  /**
   * POST /transport/vehicles/:vehicleId/gps — record sandbox GPS ping
   */
  fastify.post(
    `${prefix}/vehicles/:vehicleId/gps`,
    async function recordGpsHandler(
      request: FastifyRequest<{ Params: VehicleParams; Body: RecordGpsPingInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(VehicleParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid vehicle ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const bodyResult = validate(RecordGpsPingSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      try {
        const result = await transportService.recordGpsPing(
          tenantId,
          paramsResult.data.vehicleId,
          bodyResult.data,
        );
        return reply.status(201).send({
          ...result,
          recordedAt: result.recordedAt.toISOString(),
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
   * GET /transport/vehicles/:vehicleId/gps — list sandbox GPS pings
   */
  fastify.get(
    `${prefix}/vehicles/:vehicleId/gps`,
    async function listGpsHandler(
      request: FastifyRequest<{ Params: VehicleParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(VehicleParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid vehicle ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      try {
        const result = await transportService.listGpsPings(tenantId, paramsResult.data.vehicleId);
        return reply.status(200).send({
          data: result.data.map((p) => ({
            ...p,
            recordedAt: p.recordedAt.toISOString(),
          })),
          mode: result.mode,
          honestyNote: result.honestyNote,
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
   * POST /transport/attendance-on-bus — sandbox board/alight event
   */
  fastify.post(
    `${prefix}/attendance-on-bus`,
    async function recordBusAttendanceHandler(
      request: FastifyRequest<{ Body: RecordBusAttendanceInput }>,
      reply: FastifyReply,
    ) {
      const bodyResult = validate(RecordBusAttendanceSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      try {
        const result = await transportService.recordBusAttendance(tenantId, bodyResult.data);
        return reply.status(201).send({
          ...result,
          recordedAt: result.recordedAt.toISOString(),
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
   * GET /transport/attendance-on-bus — list sandbox boarding events
   */
  fastify.get(
    `${prefix}/attendance-on-bus`,
    async function listBusAttendanceHandler(
      request: FastifyRequest<{
        Querystring: { vehicleId?: string; studentId?: string; routeId?: string };
      }>,
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
      const result = await transportService.listBusAttendance(tenantId, {
        vehicleId: request.query.vehicleId,
        studentId: request.query.studentId,
        routeId: request.query.routeId,
      });
      return reply.status(200).send({
        data: result.data.map((e) => ({
          ...e,
          recordedAt: e.recordedAt.toISOString(),
        })),
        mode: result.mode,
        honestyNote: result.honestyNote,
      });
    },
  );
}
