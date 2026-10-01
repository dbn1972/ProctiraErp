/**
 * Staff leave routes — list/create/decide.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  CreateStaffLeaveSchema,
  DecideStaffLeaveSchema,
  SetStaffLeaveBalanceSchema,
  StaffLeaveBalanceParamsSchema,
  StaffLeaveParamsSchema,
  type CreateStaffLeaveInput,
  type DecideStaffLeaveInput,
  type SetStaffLeaveBalanceInput,
  type StaffLeaveBalanceParams,
  type StaffLeaveParams,
} from './leave-schemas.js';
import type { StaffLeaveService } from './leave-service.js';
import { requireStaffAction, staffWritePreHandler } from './staff-http-guard.js';

export interface StaffLeaveRoutesOptions {
  leaveService: StaffLeaveService;
  prefix?: string;
  /**
   * PRC-H091: tenant-scoped staff existence check for balance routes. Missing
   * staff (or staff owned by another tenant) -> 404. Required for balance routes.
   */
  staffExists?: (tenantId: string, staffId: string) => Promise<boolean>;
}

function formatBalance(entity: {
  staffId: string;
  leaveType: string;
  balanceDays: number;
  updatedAt: Date;
}) {
  return {
    staffId: entity.staffId,
    leaveType: entity.leaveType,
    balanceDays: entity.balanceDays,
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/** Actor from verified JWT only (G-102 — never trust x-user-id headers). */
function getActorId(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string } }).user;
  return user?.sub ?? 'anonymous';
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
  const { leaveService, prefix = '/staff', staffExists } = options;

  fastify.addHook('preHandler', async (request, reply) => {
    staffWritePreHandler(request, reply, 'staff.hr.write');
  });

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

  // PRC-H091: leave balances were unreachable over HTTP. Guarded by the
  // plugin-wide staff.hr.write preHandler; PUT is covered by gateway mutation audit.
  if (staffExists) {
    const resolveStaff = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<{ tenantId: string; staffId: string } | null> => {
      // The plugin preHandler skips GET; balances are HR data -> enforce on reads too.
      if (!requireStaffAction(request, reply, 'staff.hr.write')) return null;
      const params = validate(StaffLeaveBalanceParamsSchema, request.params);
      if (!params.success) {
        await reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid staff ID',
          statusCode: 400,
          errors: params.errors,
        });
        return null;
      }
      const tenantId = getTenantId(request);
      if (!tenantId) {
        await reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
        return null;
      }
      if (!(await staffExists(tenantId, params.data.id))) {
        await reply.status(404).send({
          code: 'NOT_FOUND',
          message: `Staff with id '${params.data.id}' not found`,
          statusCode: 404,
        });
        return null;
      }
      return { tenantId, staffId: params.data.id };
    };

    fastify.get(
      `${prefix}/:id/leave-balances`,
      async function listLeaveBalancesHandler(
        request: FastifyRequest<{ Params: StaffLeaveBalanceParams }>,
        reply: FastifyReply,
      ) {
        const scope = await resolveStaff(request, reply);
        if (!scope) return reply;
        const balances = await leaveService.listBalances(scope.tenantId, scope.staffId);
        return reply.status(200).send({ data: balances.map(formatBalance) });
      },
    );

    fastify.put(
      `${prefix}/:id/leave-balances`,
      async function setLeaveBalanceHandler(
        request: FastifyRequest<{
          Params: StaffLeaveBalanceParams;
          Body: SetStaffLeaveBalanceInput;
        }>,
        reply: FastifyReply,
      ) {
        const body = validate(SetStaffLeaveBalanceSchema, request.body);
        if (!body.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            statusCode: 400,
            errors: body.errors,
          });
        }
        const scope = await resolveStaff(request, reply);
        if (!scope) return reply;
        const balance = await leaveService.setBalance(
          scope.tenantId,
          scope.staffId,
          body.data.leaveType,
          body.data.balanceDays,
        );
        return reply.status(200).send(formatBalance(balance));
      },
    );
  }
}
