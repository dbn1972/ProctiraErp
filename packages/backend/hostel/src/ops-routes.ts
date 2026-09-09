/**
 * Hostel ops routes — mess, gate pass, fee structures, attendance (G-921).
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { HostelService } from './hostel-service.js';
import {
  CreateAttendanceSchema,
  CreateFeeStructureSchema,
  CreateGatePassSchema,
  CreateMessMenuItemSchema,
  CreateMessPlanSchema,
  CreateMessSubscriptionSchema,
  GatePassParamsSchema,
  TransitionGatePassSchema,
  type CreateAttendanceInput,
  type CreateFeeStructureInput,
  type CreateGatePassInput,
  type CreateMessMenuItemInput,
  type CreateMessPlanInput,
  type CreateMessSubscriptionInput,
  type GatePassParams,
  type TransitionGatePassInput,
} from './schemas.js';

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function actorId(request: FastifyRequest): string {
  return (request as FastifyRequest & { user?: { sub?: string } }).user?.sub ?? 'hostel-system';
}

function tenantRequired(reply: FastifyReply) {
  return reply.status(400).send({
    code: 'TENANT_REQUIRED',
    message: 'Tenant context is required',
    statusCode: 400,
  });
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function registerHostelOpsRoutes(
  fastify: FastifyInstance,
  hostelService: HostelService,
  prefix: string,
): Promise<void> {
  fastify.get(`${prefix}/mess/plans`, async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const hostelId =
      typeof (request.query as { hostelId?: string }).hostelId === 'string'
        ? (request.query as { hostelId?: string }).hostelId
        : undefined;
    const plans = await hostelService.listMessPlans(tenantId, hostelId);
    return reply.status(200).send({
      data: plans.map((p) => ({
        id: p.id,
        tenantId: p.tenantId,
        hostelId: p.hostelId,
        name: p.name,
        mealCount: p.mealCount,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  });

  fastify.post(
    `${prefix}/mess/plans`,
    async (request: FastifyRequest<{ Body: CreateMessPlanInput }>, reply) => {
      const result = validate(CreateMessPlanSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const plan = await hostelService.createMessPlan(tenantId, result.data);
        return reply.status(201).send({
          id: plan.id,
          tenantId: plan.tenantId,
          hostelId: plan.hostelId,
          name: plan.name,
          mealCount: plan.mealCount,
          status: plan.status,
          createdAt: plan.createdAt.toISOString(),
          updatedAt: plan.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.get(`${prefix}/mess/menu`, async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const planId = (request.query as { planId?: string }).planId;
    if (!planId) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'planId is required',
        statusCode: 400,
      });
    }
    const items = await hostelService.listMessMenu(tenantId, planId);
    return reply.status(200).send({
      data: items.map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        planId: m.planId,
        weekday: m.weekday,
        meal: m.meal,
        itemName: m.itemName,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      })),
    });
  });

  fastify.post(
    `${prefix}/mess/menu`,
    async (request: FastifyRequest<{ Body: CreateMessMenuItemInput }>, reply) => {
      const result = validate(CreateMessMenuItemSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const item = await hostelService.addMessMenuItem(tenantId, result.data);
        return reply.status(201).send({
          id: item.id,
          tenantId: item.tenantId,
          planId: item.planId,
          weekday: item.weekday,
          meal: item.meal,
          itemName: item.itemName,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.get(`${prefix}/mess/subscriptions`, async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const planId =
      typeof (request.query as { planId?: string }).planId === 'string'
        ? (request.query as { planId?: string }).planId
        : undefined;
    const rows = await hostelService.listMessSubscriptions(tenantId, planId);
    return reply.status(200).send({
      data: rows.map((s) => ({
        id: s.id,
        tenantId: s.tenantId,
        planId: s.planId,
        studentId: s.studentId,
        startDate: s.startDate,
        endDate: s.endDate,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  });

  fastify.post(
    `${prefix}/mess/subscriptions`,
    async (request: FastifyRequest<{ Body: CreateMessSubscriptionInput }>, reply) => {
      const result = validate(CreateMessSubscriptionSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const sub = await hostelService.subscribeMess(tenantId, result.data);
        return reply.status(201).send({
          id: sub.id,
          tenantId: sub.tenantId,
          planId: sub.planId,
          studentId: sub.studentId,
          startDate: sub.startDate,
          endDate: sub.endDate,
          status: sub.status,
          createdAt: sub.createdAt.toISOString(),
          updatedAt: sub.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.get(`${prefix}/gate-passes`, async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const hostelId =
      typeof (request.query as { hostelId?: string }).hostelId === 'string'
        ? (request.query as { hostelId?: string }).hostelId
        : undefined;
    const rows = await hostelService.listGatePasses(tenantId, hostelId);
    return reply.status(200).send({
      data: rows.map((g) => ({
        id: g.id,
        tenantId: g.tenantId,
        hostelId: g.hostelId,
        studentId: g.studentId,
        requestedBy: g.requestedBy,
        requesterUserId: g.requesterUserId,
        reason: g.reason,
        expectedOutAt: g.expectedOutAt.toISOString(),
        expectedInAt: g.expectedInAt.toISOString(),
        status: g.status,
        decidedBy: g.decidedBy,
        outAt: iso(g.outAt),
        inAt: iso(g.inAt),
        overdueReturn: g.overdueReturn,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      })),
    });
  });

  fastify.post(
    `${prefix}/gate-passes`,
    async (request: FastifyRequest<{ Body: CreateGatePassInput }>, reply) => {
      const result = validate(CreateGatePassSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const pass = await hostelService.requestGatePass(tenantId, result.data);
        return reply.status(201).send({
          id: pass.id,
          tenantId: pass.tenantId,
          hostelId: pass.hostelId,
          studentId: pass.studentId,
          requestedBy: pass.requestedBy,
          requesterUserId: pass.requesterUserId,
          reason: pass.reason,
          expectedOutAt: pass.expectedOutAt.toISOString(),
          expectedInAt: pass.expectedInAt.toISOString(),
          status: pass.status,
          decidedBy: pass.decidedBy,
          outAt: iso(pass.outAt),
          inAt: iso(pass.inAt),
          createdAt: pass.createdAt.toISOString(),
          updatedAt: pass.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/gate-passes/:id/transition`,
    async (
      request: FastifyRequest<{ Params: GatePassParams; Body: TransitionGatePassInput }>,
      reply,
    ) => {
      const paramsResult = validate(GatePassParamsSchema, request.params);
      const bodyResult = validate(TransitionGatePassSchema, request.body);
      if (!paramsResult.success || !bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: [...(paramsResult.success ? [] : paramsResult.errors), ...(bodyResult.success ? [] : bodyResult.errors)],
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const pass = await hostelService.transitionGatePass(
          tenantId,
          paramsResult.data.id,
          bodyResult.data.status,
          actorId(request),
        );
        return reply.status(200).send({
          id: pass.id,
          status: pass.status,
          decidedBy: pass.decidedBy,
          outAt: iso(pass.outAt),
          inAt: iso(pass.inAt),
          overdueReturn: pass.overdueReturn,
          expectedOutAt: pass.expectedOutAt.toISOString(),
          expectedInAt: pass.expectedInAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  async function sendGateTransition(
    request: FastifyRequest<{ Params: GatePassParams }>,
    reply: FastifyReply,
    status: TransitionGatePassInput['status'],
  ) {
    const paramsResult = validate(GatePassParamsSchema, request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid gate pass ID',
        statusCode: 400,
        errors: paramsResult.errors,
      });
    }
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const pass = await hostelService.transitionGatePass(
        tenantId,
        paramsResult.data.id,
        status,
        actorId(request),
      );
      return reply.status(200).send({
        id: pass.id,
        status: pass.status,
        decidedBy: pass.decidedBy,
        outAt: iso(pass.outAt),
        inAt: iso(pass.inAt),
        overdueReturn: pass.overdueReturn,
        expectedOutAt: pass.expectedOutAt.toISOString(),
        expectedInAt: pass.expectedInAt.toISOString(),
      });
    } catch (error: unknown) {
      if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
      throw error;
    }
  }

  for (const [path, status] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
    ['out', 'out'],
    ['in', 'in'],
  ] as const) {
    fastify.post(
      `${prefix}/gate-passes/:id/${path}`,
      async (request: FastifyRequest<{ Params: GatePassParams }>, reply) =>
        sendGateTransition(request, reply, status),
    );
  }

  fastify.get(`${prefix}/fee-structures/summary`, async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const hostelId =
      typeof (request.query as { hostelId?: string }).hostelId === 'string'
        ? (request.query as { hostelId?: string }).hostelId
        : undefined;
    const summary = await hostelService.summarizeFeeStructures(tenantId, hostelId);
    return reply.status(200).send({
      hostelId: summary.hostelId,
      count: summary.count,
      totalAmountCents: summary.totalAmountCents,
      currency: summary.currency,
      structures: summary.structures.map((s) => ({
        id: s.id,
        tenantId: s.tenantId,
        hostelId: s.hostelId,
        roomType: s.roomType,
        termLabel: s.termLabel,
        amountCents: s.amountCents,
        currency: s.currency,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  });

  fastify.get(`${prefix}/fee-structures`, async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const hostelId =
      typeof (request.query as { hostelId?: string }).hostelId === 'string'
        ? (request.query as { hostelId?: string }).hostelId
        : undefined;
    const summary = await hostelService.summarizeFeeStructures(tenantId, hostelId);
    return reply.status(200).send({
      hostelId: summary.hostelId,
      count: summary.count,
      totalAmountCents: summary.totalAmountCents,
      currency: summary.currency,
      data: summary.structures.map((s) => ({
        id: s.id,
        tenantId: s.tenantId,
        hostelId: s.hostelId,
        roomType: s.roomType,
        termLabel: s.termLabel,
        amountCents: s.amountCents,
        currency: s.currency,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  });

  fastify.post(
    `${prefix}/fee-structures`,
    async (request: FastifyRequest<{ Body: CreateFeeStructureInput }>, reply) => {
      const result = validate(CreateFeeStructureSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const row = await hostelService.createFeeStructure(tenantId, result.data);
        return reply.status(201).send({
          id: row.id,
          tenantId: row.tenantId,
          hostelId: row.hostelId,
          roomType: row.roomType,
          termLabel: row.termLabel,
          amountCents: row.amountCents,
          currency: row.currency,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.get(`${prefix}/attendance`, async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const q = request.query as { blockId?: string; onDate?: string };
    if (!q.blockId || !q.onDate) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'blockId and onDate are required',
        statusCode: 400,
      });
    }
    const rows = await hostelService.listAttendance(tenantId, q.blockId, q.onDate);
    return reply.status(200).send({
      data: rows.map((a) => ({
        id: a.id,
        tenantId: a.tenantId,
        blockId: a.blockId,
        studentId: a.studentId,
        onDate: a.onDate,
        status: a.status,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
    });
  });

  fastify.post(
    `${prefix}/attendance`,
    async (request: FastifyRequest<{ Body: CreateAttendanceInput }>, reply) => {
      const result = validate(CreateAttendanceSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const mark = await hostelService.upsertAttendance(tenantId, result.data);
        return reply.status(201).send({
          id: mark.id,
          tenantId: mark.tenantId,
          blockId: mark.blockId,
          studentId: mark.studentId,
          onDate: mark.onDate,
          status: mark.status,
          reason: mark.reason,
          createdAt: mark.createdAt.toISOString(),
          updatedAt: mark.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.put(
    `${prefix}/attendance`,
    async (request: FastifyRequest<{ Body: CreateAttendanceInput }>, reply) => {
      const result = validate(CreateAttendanceSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const mark = await hostelService.upsertAttendance(tenantId, result.data);
        return reply.status(200).send({
          id: mark.id,
          tenantId: mark.tenantId,
          blockId: mark.blockId,
          studentId: mark.studentId,
          onDate: mark.onDate,
          status: mark.status,
          reason: mark.reason,
          createdAt: mark.createdAt.toISOString(),
          updatedAt: mark.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );
}
