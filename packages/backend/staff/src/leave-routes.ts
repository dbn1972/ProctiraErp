/**
 * Staff leave routes — list/create/decide.
 */
import { AppError } from '@proctira/common';
import { validate, validateQuery } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ListPageQuerySchema, pageMeta, toPageWindow } from './hr-schemas.js';
import {
  CreateStaffLeaveSchema,
  DecideStaffLeaveSchema,
  ImportStaffLeaveBalancesSchema,
  SetStaffLeaveBalanceSchema,
  StaffLeaveBalanceParamsSchema,
  StaffLeaveParamsSchema,
  type CreateStaffLeaveInput,
  type DecideStaffLeaveInput,
  type ImportStaffLeaveBalancesInput,
  type SetStaffLeaveBalanceInput,
  type StaffLeaveBalanceParams,
  type StaffLeaveParams,
} from './leave-schemas.js';
import type { StaffLeaveService } from './leave-service.js';
import {
  assertStaffWritableOr404,
  requireStaffAction,
  staffWritePreHandler,
} from './staff-http-guard.js';
import type { StaffService } from './staff-service.js';

export interface StaffLeaveRoutesOptions {
  leaveService: StaffLeaveService;
  /** PRC-H090: used to enforce school-scope on leave writes. */
  staffService: StaffService;
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
  const { leaveService, staffService, prefix = '/staff', staffExists } = options;

  fastify.addHook('preHandler', async (request, reply) => {
    if (!staffWritePreHandler(request, reply, 'staff.hr.write')) return reply;
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

      // PRC-M379: bounded pages; invalid paging -> 400.
      const query = validateQuery(ListPageQuerySchema, request.query ?? {});
      if (!query.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          statusCode: 400,
          errors: query.errors,
        });
      }
      const w = toPageWindow(query.data);
      const { rows, total } = await leaveService.listLeavesPage(tenantId, w);
      return reply
        .status(200)
        .send({ data: rows.map(formatLeave), meta: pageMeta(w.page, w.pageSize, total) });
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
        // PRC-H090: leave requests are scoped to the caller's institution(s).
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            tenantId,
            result.data.staffId,
          ))
        )
          return reply;
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
        // PRC-H090: resolve the leave's staff and enforce school scope before deciding.
        const existing = await leaveService.getLeave(tenantId, paramsResult.data.id);
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            tenantId,
            existing.staffId,
          ))
        )
          return reply;
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
        // PRC-H090: a school-bound caller may only set balances for its own staff.
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            scope.tenantId,
            scope.staffId,
          ))
        )
          return reply;
        const balance = await leaveService.setBalance(
          scope.tenantId,
          scope.staffId,
          body.data.leaveType,
          body.data.balanceDays,
        );
        return reply.status(200).send(formatBalance(balance));
      },
    );

    /**
     * PRC-H091: bulk opening-balance import (all-or-nothing). Any duplicate row or staff
     * missing from the tenant rejects the batch with 400 and writes nothing. `dryRun`
     * validates only. Accrual policy (monthly job vs annual grant) is a separate decision;
     * this endpoint seeds/overwrites absolute balances.
     */
    fastify.post(
      `${prefix}/leave-balances/import`,
      async function importLeaveBalancesHandler(
        request: FastifyRequest<{ Body: ImportStaffLeaveBalancesInput }>,
        reply: FastifyReply,
      ) {
        if (!requireStaffAction(request, reply, 'staff.hr.write')) return reply;
        const body = validate(ImportStaffLeaveBalancesSchema, request.body);
        if (!body.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            statusCode: 400,
            errors: body.errors,
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
          // PRC-H090: every staff member in the batch must be in the caller's institution(s).
          for (const staffId of new Set(body.data.rows.map((r) => r.staffId))) {
            if (!(await assertStaffWritableOr404(request, reply, staffService, tenantId, staffId)))
              return reply;
          }
          const result = await leaveService.importOpeningBalances(
            tenantId,
            body.data.rows,
            staffExists,
            { dryRun: body.data.dryRun },
          );
          // eslint-disable-next-line no-console
          console.info(
            JSON.stringify({
              msg: 'staff.leave_balances.import',
              tenantId,
              actorId: getActorId(request),
              rows: body.data.rows.length,
              imported: result.imported,
              dryRun: result.dryRun,
            }),
          );
          return reply.status(200).send({
            dryRun: result.dryRun,
            rows: body.data.rows.length,
            imported: result.imported,
            data: result.balances.map(formatBalance),
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
}
