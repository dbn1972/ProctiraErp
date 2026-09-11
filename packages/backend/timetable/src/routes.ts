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
  CreateSectionSchema,
  UpdateSectionSchema,
  EnrollStudentSchema,
  BulkEnrollStudentsSchema,
  CreateRoomSchema,
  CreateGenerationJobSchema,
  CreateTeacherAbsenceSchema,
} from './schemas.js';
import { assertTimetableAccess, type TimetableAction } from './timetable-access.js';
import { isTimetableClashError, isTimetableSchemaMissingError } from './timetable-errors.js';
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

function requestRoles(request: FastifyRequest): unknown {
  const user = (
    request as FastifyRequest & {
      user?: { roles?: unknown };
    }
  ).user;
  return user?.roles ?? [];
}

function requireAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: TimetableAction,
): boolean {
  try {
    assertTimetableAccess(requestRoles(request), action);
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
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
      if (!row)
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Bell schedule not found', statusCode: 404 });
      const periods = await service.listPeriods(tenantId, id);
      return reply.send({ ...row, periods });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/bell-schedules`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
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
    if (!requireAction(request, reply, 'schedule.write')) return;
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
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Bell schedule not found', statusCode: 404 });
      }
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.delete(`${prefix}/bell-schedules/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    try {
      const { id } = request.params as { id: string };
      const ok = await service.deleteBellSchedule(tenantId, id);
      if (!ok) {
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Bell schedule not found', statusCode: 404 });
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
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Bell schedule not found', statusCode: 404 });
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
    if (!requireAction(request, reply, 'schedule.write')) return;
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
    if (!requireAction(request, reply, 'schedule.write')) return;
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
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Period not found', statusCode: 404 });
      }
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.delete(`${prefix}/periods/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    try {
      const { id } = request.params as { id: string };
      const ok = await service.deletePeriod(tenantId, id);
      if (!ok) {
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Period not found', statusCode: 404 });
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
        sectionId?: string;
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
    if (!requireAction(request, reply, 'schedule.write')) return;
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
    if (!requireAction(request, reply, 'schedule.write')) return;
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
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Meeting not found', statusCode: 404 });
      }
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.delete(`${prefix}/meetings/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    try {
      const { id } = request.params as { id: string };
      const ok = await service.deleteMeeting(tenantId, id);
      if (!ok) {
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Meeting not found', statusCode: 404 });
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
    if (!requireAction(request, reply, 'schedule.write')) return;
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

  // ── Rooms ───────────────────────────────────────────────────────────────────

  fastify.get(`${prefix}/rooms`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as { institutionId?: string };
      const rows = await service.listRooms(tenantId, {
        institutionId: query.institutionId,
      });
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/rooms`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    const validated = validate(CreateRoomSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await service.createRoom(tenantId, {
        institutionId: validated.data.institutionId,
        code: validated.data.code,
        name: validated.data.name,
        capacity: validated.data.capacity ?? 30,
        roomType: validated.data.roomType ?? 'CLASSROOM',
        status: validated.data.status ?? 'active',
      });
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  // ── Conflict engine surface (G-304) ───────────────────────────────────────

  fastify.get(`${prefix}/conflicts`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as {
        institutionId?: string;
        academicPeriodId?: string;
      };
      if (!query.institutionId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'institutionId is required',
          statusCode: 400,
        });
      }
      const rows = await service.listConflicts(tenantId, {
        institutionId: query.institutionId,
        academicPeriodId: query.academicPeriodId,
      });
      return reply.send({ data: rows, count: rows.length });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  // ── Sections (master schedule) ────────────────────────────────────────────

  fastify.get(`${prefix}/sections`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as {
        institutionId?: string;
        academicPeriodId?: string;
        status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
      };
      const rows = await service.listSections(tenantId, query);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/sections/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const row = await service.getSection(tenantId, id);
      if (!row) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Section not found',
          statusCode: 404,
        });
      }
      const [enrollments, meetings] = await Promise.all([
        service.listEnrollments(tenantId, id),
        service.listMeetings(tenantId, { sectionId: id }),
      ]);
      return reply.send({ ...row, enrollments, meetings });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/sections`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    const validated = validate(CreateSectionSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await service.createSection(tenantId, {
        institutionId: validated.data.institutionId,
        academicPeriodId: validated.data.academicPeriodId,
        name: validated.data.name,
        code: validated.data.code,
        gradeId: validated.data.gradeId ?? null,
        primaryTeacherId: validated.data.primaryTeacherId ?? null,
        defaultRoomId: validated.data.defaultRoomId ?? null,
        capacity: validated.data.capacity ?? 40,
      });
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.put(`${prefix}/sections/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    const validated = validate(UpdateSectionSchema, request.body);
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
      const row = await service.updateSection(tenantId, id, validated.data);
      if (!row) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Section not found',
          statusCode: 404,
        });
      }
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.delete(`${prefix}/sections/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    try {
      const { id } = request.params as { id: string };
      const ok = await service.deleteSection(tenantId, id);
      if (!ok) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Section not found',
          statusCode: 404,
        });
      }
      return reply.status(204).send();
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/sections/:id/enrollments`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const section = await service.getSection(tenantId, id);
      if (!section) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Section not found',
          statusCode: 404,
        });
      }
      const rows = await service.listEnrollments(tenantId, id);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/sections/:id/enrollments`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    const validated = validate(EnrollStudentSchema, request.body);
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
      const row = await service.enrollStudent(tenantId, id, validated.data.studentId);
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/sections/:id/enrollments/bulk`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    const validated = validate(BulkEnrollStudentsSchema, request.body);
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
      const section = await service.getSection(tenantId, id);
      if (!section) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Section not found',
          statusCode: 404,
        });
      }
      const result = await service.bulkEnrollStudents(tenantId, id, validated.data.studentIds);
      return reply.status(200).send({
        enrolled: result.enrolled,
        failed: result.failed,
        summary: {
          requested: validated.data.studentIds.length,
          enrolled: result.enrolled.length,
          failed: result.failed.length,
        },
      });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.delete(`${prefix}/sections/:id/enrollments/:studentId`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    try {
      const { id, studentId } = request.params as { id: string; studentId: string };
      const row = await service.withdrawStudent(tenantId, id, studentId);
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/sections/:id/publish`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.publish')) return;
    try {
      const { id } = request.params as { id: string };
      const row = await service.publishSection(tenantId, id);
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/sections/:id/unpublish`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.publish')) return;
    try {
      const { id } = request.params as { id: string };
      const row = await service.unpublishSection(tenantId, id);
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  // ── Attendance periods from published meetings ────────────────────────────

  fastify.get(`${prefix}/attendance-periods`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as { institutionId?: string; dayOfWeek?: string };
      if (!query.institutionId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'institutionId is required',
          statusCode: 400,
        });
      }
      const dayOfWeek = query.dayOfWeek ? Number(query.dayOfWeek) : undefined;
      const rows = await service.listAttendancePeriods(tenantId, {
        institutionId: query.institutionId,
        dayOfWeek: Number.isFinite(dayOfWeek) ? dayOfWeek : undefined,
      });
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  // ── Generation jobs (G-917) ───────────────────────────────────────────────

  fastify.get(`${prefix}/generation-jobs`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as { institutionId?: string };
      const rows = await service.listGenerationJobs(tenantId, {
        institutionId: query.institutionId,
      });
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/generation-jobs/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const row = await service.getGenerationJob(tenantId, id);
      if (!row) {
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Generation job not found', statusCode: 404 });
      }
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/generation-jobs`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    const validated = validate(CreateGenerationJobSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const actor = (request as FastifyRequest & { user?: { sub?: string } }).user?.sub ?? null;
      const row = await service.runGenerationJob(tenantId, validated.data, actor);
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  // ── Teacher absences / affected periods (G-917) ───────────────────────────

  fastify.post(`${prefix}/teacher-absences`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.write')) return;
    const validated = validate(CreateTeacherAbsenceSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const actor = (request as FastifyRequest & { user?: { sub?: string } }).user?.sub ?? null;
      const row = await service.markTeacherAbsent(tenantId, validated.data, actor);
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/teacher-absences/affected`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as {
        institutionId?: string;
        staffId?: string;
        date?: string;
      };
      if (!query.institutionId || !query.staffId || !query.date) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'institutionId, staffId and date are required',
          statusCode: 400,
        });
      }
      const rows = await service.listAffectedPeriods(tenantId, {
        institutionId: query.institutionId,
        staffId: query.staffId,
        date: query.date,
      });
      return reply.send({ data: rows, count: rows.length });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });
  fastify.post<{ Body: { sourcePeriodId?: string; targetPeriodId?: string } }>(
    `${prefix}/clone-period`,
    async (request, reply) => {
      const sourcePeriodId = request.body?.sourcePeriodId;
      const targetPeriodId = request.body?.targetPeriodId;
      if (!sourcePeriodId || !targetPeriodId) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'sourcePeriodId and targetPeriodId are required',
        });
      }
      const tenantId =
        (request as { tenantId?: string }).tenantId ??
        (typeof request.headers['x-tenant-id'] === 'string' ? request.headers['x-tenant-id'] : undefined);
      if (!tenantId) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'tenant required' });
      }
      const result = await service.cloneForAcademicPeriod(tenantId, sourcePeriodId, targetPeriodId);
      return reply.code(201).send(result);
    },
  );

}
