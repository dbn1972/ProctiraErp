/**
 * Timetable Fastify routes (WS1).
 *
 * Prefix default: `/timetable`
 * - Bell schedules + periods CRUD
 * - Section meetings (institution timetable grid)
 * - Substitutions list/create with teacher double-book → 409
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  CreateBellScheduleSchema,
  UpdateBellScheduleSchema,
  CreatePeriodSchema,
  UpdatePeriodSchema,
  CreateMeetingSchema,
  UpdateMeetingSchema,
  CreateSubstitutionSchema,
} from './schemas.js';
import {
  isTimetableClashError,
  isTimetableSchemaMissingError,
} from './timetable-errors.js';
import type { TimetableService } from './timetable-service.js';

export interface TimetableRoutesOptions {
  service: TimetableService;
  prefix?: string;
}

function tenantIdOf(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  const tenantId =
    user?.tenantId ??
    (request as FastifyRequest & { tenantId?: string }).tenantId ??
    (request.headers['x-tenant-id'] as string | undefined);
  if (!tenantId) {
    reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Tenant context required (user.tenantId or x-tenant-id)',
      statusCode: 401,
    });
    return undefined;
  }
  return tenantId;
}

function sendDomainError(reply: FastifyReply, error: unknown) {
  if (isTimetableClashError(error)) {
    return reply.status(409).send(error.toJSON());
  }
  if (isTimetableSchemaMissingError(error)) {
    return reply.status(503).send(error.toJSON());
  }
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

export async function registerTimetableRoutes(
  fastify: FastifyInstance,
  options: TimetableRoutesOptions,
): Promise<void> {
  const prefix = options.prefix ?? '/timetable';
  const { service } = options;

  // ── Bell schedules ────────────────────────────────────────────────────────

  fastify.get(`${prefix}/bell-schedules`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as {
        institutionId?: string;
        academicPeriodId?: string;
      };
      const rows = await service.listBellSchedules(tenantId, {
        institutionId: query.institutionId,
        academicPeriodId: query.academicPeriodId,
      });
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/bell-schedules/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const row = await service.getBellSchedule(tenantId, id);
      if (!row) return reply.status(404).send({ code: 'NOT_FOUND', message: 'Bell schedule not found', statusCode: 404 });
      const periods = await service.listPeriods(tenantId, id);
      return reply.send({ ...row, periods });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/bell-schedules`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(CreateBellScheduleSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await service.createBellSchedule(tenantId, {
        institutionId: validated.data.institutionId,
        academicPeriodId: validated.data.academicPeriodId,
        name: validated.data.name,
        code: validated.data.code,
        dayPattern: validated.data.dayPattern ?? '1,2,3,4,5',
        status: validated.data.status ?? 'active',
      });
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.put(`${prefix}/bell-schedules/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(UpdateBellScheduleSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const { id } = request.params as { id: string };
      const row = await service.updateBellSchedule(tenantId, id, validated.data);
      if (!row) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Bell schedule not found', statusCode: 404 });
      }
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.delete(`${prefix}/bell-schedules/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const ok = await service.deleteBellSchedule(tenantId, id);
      if (!ok) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Bell schedule not found', statusCode: 404 });
      }
      return reply.status(204).send();
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  // ── Periods under a bell schedule ─────────────────────────────────────────

  fastify.get(`${prefix}/bell-schedules/:bellScheduleId/periods`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { bellScheduleId } = request.params as { bellScheduleId: string };
      const schedule = await service.getBellSchedule(tenantId, bellScheduleId);
      if (!schedule) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Bell schedule not found', statusCode: 404 });
      }
      const rows = await service.listPeriods(tenantId, bellScheduleId);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/bell-schedules/:bellScheduleId/periods`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(CreatePeriodSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const { bellScheduleId } = request.params as { bellScheduleId: string };
      const row = await service.createPeriod(tenantId, {
        bellScheduleId,
        ...validated.data,
      });
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.put(`${prefix}/periods/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(UpdatePeriodSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const { id } = request.params as { id: string };
      const row = await service.updatePeriod(tenantId, id, validated.data);
      if (!row) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Period not found', statusCode: 404 });
      }
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.delete(`${prefix}/periods/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const ok = await service.deletePeriod(tenantId, id);
      if (!ok) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Period not found', statusCode: 404 });
      }
      return reply.status(204).send();
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  // ── Section meetings (timetable grid) ─────────────────────────────────────

  fastify.get(`${prefix}/meetings`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as {
        institutionId?: string;
        academicPeriodId?: string;
        staffId?: string;
      };
      const rows = await service.listMeetings(tenantId, query);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/meetings`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(CreateMeetingSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await service.createMeeting(tenantId, {
        institutionId: validated.data.institutionId,
        academicPeriodId: validated.data.academicPeriodId,
        sectionId: validated.data.sectionId,
        subjectId: validated.data.subjectId ?? null,
        staffId: validated.data.staffId,
        periodId: validated.data.periodId,
        roomId: validated.data.roomId ?? null,
        dayOfWeek: validated.data.dayOfWeek,
        status: validated.data.status ?? 'active',
      });
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.put(`${prefix}/meetings/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(UpdateMeetingSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const { id } = request.params as { id: string };
      const row = await service.updateMeeting(tenantId, id, validated.data);
      if (!row) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Meeting not found', statusCode: 404 });
      }
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.delete(`${prefix}/meetings/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const ok = await service.deleteMeeting(tenantId, id);
      if (!ok) {
        return reply.status(404).send({ code: 'NOT_FOUND', message: 'Meeting not found', statusCode: 404 });
      }
      return reply.status(204).send();
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  // ── Substitutions ─────────────────────────────────────────────────────────

  fastify.get(`${prefix}/substitutions`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as {
        institutionId?: string;
        fromDate?: string;
        toDate?: string;
      };
      const rows = await service.listSubstitutions(tenantId, query);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/substitutions`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(CreateSubstitutionSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await service.createSubstitution(tenantId, validated.data);
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });
}
