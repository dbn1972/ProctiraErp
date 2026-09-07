/**
 * Hostel routes — hostels, assignments, leaves, visitors.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { HostelService } from './hostel-service.js';
import {
  CreateAssignmentSchema,
  CreateHostelSchema,
  HostelParamsSchema,
  type CreateAssignmentInput,
  type CreateHostelInput,
  type HostelParams,
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

export async function registerHostelRoutes(
  fastify: FastifyInstance,
  options: HostelRoutesOptions,
): Promise<void> {
  const { hostelService, prefix = '/hostel' } = options;

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
        const assignment = await hostelService.createAssignment(tenantId, result.data);
        return reply.status(201).send(formatAssignment(assignment));
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
      return reply.status(200).send({ data: leaves });
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
      return reply.status(200).send({ data: visitors });
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

      const hostels = await hostelService.listHostels(tenantId);
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
