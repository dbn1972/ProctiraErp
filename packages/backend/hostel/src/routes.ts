/**
 * Hostel routes — hostels, assignments, leaves, visitors.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { HostelService } from './hostel-service.js';
import { registerHostelOpsRoutes } from './ops-routes.js';
import {
  CreateAssignmentSchema,
  CreateBedSchema,
  CreateBlockSchema,
  CreateHostelSchema,
  CreateLeaveSchema,
  CreateRoomSchema,
  CreateVisitorSchema,
  DecideLeaveSchema,
  HostelParamsSchema,
  LeaveParamsSchema,
  UpdateVisitorStatusSchema,
  VisitorParamsSchema,
  type CreateAssignmentInput,
  type CreateBedInput,
  type CreateBlockInput,
  type CreateHostelInput,
  type CreateLeaveInput,
  type CreateRoomInput,
  type CreateVisitorInput,
  type DecideLeaveInput,
  type HostelParams,
  type LeaveParams,
  type UpdateVisitorStatusInput,
  type VisitorParams,
} from './schemas.js';

export interface HostelRoutesOptions {
  hostelService: HostelService;
  prefix?: string;
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function formatHostel(entity: {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  address: string | null;
  capacity: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    code: entity.code,
    address: entity.address,
    capacity: entity.capacity,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatAssignment(entity: {
  id: string;
  tenantId: string;
  studentId: string;
  bedId: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    studentId: entity.studentId,
    bedId: entity.bedId,
    startDate: entity.startDate,
    endDate: entity.endDate,
    isActive: entity.isActive,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatLeave(entity: {
  id: string;
  tenantId: string;
  studentId: string;
  hostelId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    studentId: entity.studentId,
    hostelId: entity.hostelId,
    startDate: entity.startDate,
    endDate: entity.endDate,
    reason: entity.reason,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatVisitor(entity: {
  id: string;
  tenantId: string;
  hostelId: string;
  visitorName: string;
  studentId: string;
  visitDate: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    hostelId: entity.hostelId,
    visitorName: entity.visitorName,
    studentId: entity.studentId,
    visitDate: entity.visitDate,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatBlock(entity: {
  id: string;
  tenantId: string;
  hostelId: string;
  name: string;
  floor: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    hostelId: entity.hostelId,
    name: entity.name,
    floor: entity.floor,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatRoom(entity: {
  id: string;
  tenantId: string;
  blockId: string;
  roomNumber: string;
  capacity: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    blockId: entity.blockId,
    roomNumber: entity.roomNumber,
    capacity: entity.capacity,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatBed(entity: {
  id: string;
  tenantId: string;
  roomId: string;
  bedLabel: string;
  isAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    roomId: entity.roomId,
    bedLabel: entity.bedLabel,
    isAvailable: entity.isAvailable,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export async function registerHostelRoutes(
  fastify: FastifyInstance,
  options: HostelRoutesOptions,
): Promise<void> {
  const { hostelService, prefix = '/hostel' } = options;

  fastify.get(
    `${prefix}/blocks`,
    async function listBlocksHandler(
      request: FastifyRequest<{ Querystring: { hostelId?: string } }>,
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

      const hostelId = request.query.hostelId;
      const blocks = await hostelService.listBlocks(tenantId, hostelId);
      return reply.status(200).send({ data: blocks.map(formatBlock) });
    },
  );

  fastify.post(
    `${prefix}/blocks`,
    async function createBlockHandler(
      request: FastifyRequest<{ Body: CreateBlockInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateBlockSchema, request.body);
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
        const block = await hostelService.createBlock(tenantId, result.data);
        return reply.status(201).send(formatBlock(block));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/rooms`,
    async function listRoomsHandler(
      request: FastifyRequest<{ Querystring: { blockId?: string } }>,
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

      const blockId = request.query.blockId;
      const rooms = await hostelService.listRooms(tenantId, blockId);
      return reply.status(200).send({ data: rooms.map(formatRoom) });
    },
  );

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

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const room = await hostelService.createRoom(tenantId, result.data);
        return reply.status(201).send(formatRoom(room));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/beds`,
    async function listBedsHandler(
      request: FastifyRequest<{ Querystring: { roomId?: string } }>,
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

      const roomId = request.query.roomId;
      const beds = await hostelService.listBeds(tenantId, roomId);
      return reply.status(200).send({ data: beds.map(formatBed) });
    },
  );

  fastify.post(
    `${prefix}/beds`,
    async function createBedHandler(
      request: FastifyRequest<{ Body: CreateBedInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateBedSchema, request.body);
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
        const bed = await hostelService.createBed(tenantId, result.data);
        return reply.status(201).send(formatBed(bed));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/assignments`,
    async function listAssignmentsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const assignments = await hostelService.listAssignments(tenantId);
      return reply.status(200).send({ data: assignments.map(formatAssignment) });
    },
  );

  fastify.post(
    `${prefix}/assignments`,
    async function createAssignmentHandler(
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

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const actorId =
          (request as FastifyRequest & { user?: { sub?: string } }).user?.sub ?? 'hostel-system';
        const assignment = await hostelService.createAssignment(tenantId, result.data, actorId);
        return reply.status(201).send({
          ...formatAssignment(assignment),
          invoice: assignment.invoice,
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/leaves`,
    async function listLeavesHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const leaves = await hostelService.listLeaves(tenantId);
      return reply.status(200).send({ data: leaves.map(formatLeave) });
    },
  );

  fastify.post(
    `${prefix}/leaves`,
    async function createLeaveHandler(
      request: FastifyRequest<{ Body: CreateLeaveInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateLeaveSchema, request.body);
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
        const leave = await hostelService.createLeave(tenantId, result.data);
        return reply.status(201).send(formatLeave(leave));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/leaves/:id/decide`,
    async function decideLeaveHandler(
      request: FastifyRequest<{ Params: LeaveParams; Body: DecideLeaveInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(LeaveParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid leave ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(DecideLeaveSchema, request.body);
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
        const leave = await hostelService.decideLeave(
          tenantId,
          paramsResult.data.id,
          bodyResult.data.status,
        );
        return reply.status(200).send(formatLeave(leave));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/visitors`,
    async function listVisitorsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const visitors = await hostelService.listVisitors(tenantId);
      return reply.status(200).send({ data: visitors.map(formatVisitor) });
    },
  );

  fastify.post(
    `${prefix}/visitors`,
    async function createVisitorHandler(
      request: FastifyRequest<{ Body: CreateVisitorInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateVisitorSchema, request.body);
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
        const visitor = await hostelService.createVisitor(tenantId, result.data);
        return reply.status(201).send(formatVisitor(visitor));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/visitors/:id/status`,
    async function updateVisitorStatusHandler(
      request: FastifyRequest<{ Params: VisitorParams; Body: UpdateVisitorStatusInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(VisitorParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid visitor ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateVisitorStatusSchema, request.body);
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
        const visitor = await hostelService.updateVisitorStatus(
          tenantId,
          paramsResult.data.id,
          bodyResult.data.status,
        );
        return reply.status(200).send(formatVisitor(visitor));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    prefix,
    async function listHostelsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const institutionId =
        typeof (request.query as { institutionId?: string }).institutionId === 'string'
          ? (request.query as { institutionId?: string }).institutionId
          : undefined;
      let hostels = await hostelService.listHostels(tenantId);
      if (institutionId) {
        hostels = hostels.filter((h) => {
          const id = (h as { institutionId?: string | null }).institutionId;
          return id == null || id === institutionId;
        });
      }
      return reply.status(200).send({ data: hostels.map(formatHostel) });
    },
  );

  fastify.post(
    prefix,
    async function createHostelHandler(
      request: FastifyRequest<{ Body: CreateHostelInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateHostelSchema, request.body);
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
        const hostel = await hostelService.createHostel(tenantId, result.data);
        return reply.status(201).send(formatHostel(hostel));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  await registerHostelOpsRoutes(fastify, hostelService, prefix);

  fastify.get(
    `${prefix}/:id`,
    async function getHostelHandler(
      request: FastifyRequest<{ Params: HostelParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(HostelParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid hostel ID',
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
        const hostel = await hostelService.getHostel(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatHostel(hostel));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
