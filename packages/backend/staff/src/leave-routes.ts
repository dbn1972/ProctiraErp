/**
 * Staff leave routes — list/create/decide.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { StaffLeaveService } from './leave-service.js';
import {
  CreateStaffLeaveSchema,
  DecideStaffLeaveSchema,
  StaffLeaveParamsSchema,
  type CreateStaffLeaveInput,
  type DecideStaffLeaveInput,
  type StaffLeaveParams,
} from './leave-schemas.js';

export interface StaffLeaveRoutesOptions {
  leaveService: StaffLeaveService;
  prefix?: string;
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function getActorId(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string } }).user;
  const headerUserId = request.headers['x-user-id'];
  const fromHeader = Array.isArray(headerUserId) ? headerUserId[0] : headerUserId;
  return user?.sub ?? fromHeader ?? 'anonymous';
}

function formatLeave(entity: {
  id: string;
  tenantId: string;
  staffId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    staffId: entity.staffId,
    leaveType: entity.leaveType,
    startDate: entity.startDate,
    endDate: entity.endDate,
    reason: entity.reason,
    status: entity.status,
    decidedBy: entity.decidedBy,
    decidedAt: entity.decidedAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export async function registerStaffLeaveRoutes(
  fastify: FastifyInstance,
  options: StaffLeaveRoutesOptions,
): Promise<void> {
  const { leaveService, prefix = '/staff' } = options;

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

      const leaves = await leaveService.listLeaves(tenantId);
      return reply.status(200).send({ data: leaves.map(formatLeave) });
    },
  );

  fastify.post(
    `${prefix}/leaves`,
    async function createLeaveHandler(
      request: FastifyRequest<{ Body: CreateStaffLeaveInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateStaffLeaveSchema, request.body);
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
        const leave = await leaveService.createLeave(tenantId, result.data);
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
      request: FastifyRequest<{ Params: StaffLeaveParams; Body: DecideStaffLeaveInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(StaffLeaveParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid leave ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(DecideStaffLeaveSchema, request.body);
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
        const leave = await leaveService.decideLeave(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
          getActorId(request),
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
}
