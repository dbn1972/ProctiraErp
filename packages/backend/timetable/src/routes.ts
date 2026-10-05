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
  isValidIsoDate,
  UUID_PATTERN,
} from './schemas.js';
import {
  assertTimetableAccess,
  hasTimetableAccess,
  type TimetableAction,
} from './timetable-access.js';
import {
  isTimetableClashError,
  isTimetableSchemaMissingError,
  isTimetableVersionConflictError,
  normalizeIfMatchToken,
} from './timetable-errors.js';
import type { TimetableService } from './timetable-service.js';

export interface TimetableRoutesOptions {
  service: TimetableService;
  prefix?: string;
}

function tenantIdOf(request: FastifyRequest, reply: FastifyReply): string | undefined {
  // SEC-2: `x-tenant-id` is a client-supplied header and must never be trusted as a
  // tenant source. The gateway overwrites it with the JWT-verified tenant before
  // proxying (see apps/api-gateway/src/plugins/service-router.ts), but this package
  // has no standalone boot path, so there is no legitimate case where tenant identity
  // should fall back to it. Resolve strictly from server-verified sources.
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  const tenantId = user?.tenantId ?? (request as FastifyRequest & { tenantId?: string }).tenantId;
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

function ifMatchOf(request: FastifyRequest): string | undefined {
  const headers: Record<string, string | string[] | undefined> = request.headers;
  const header = headers['if-match'];
  const raw: string | undefined = Array.isArray(header) ? header[0] : header;
  return normalizeIfMatchToken(raw);
}

function setEtag(reply: FastifyReply, updatedAt: string | undefined | null) {
  if (updatedAt) {
    reply.header('ETag', `"${updatedAt}"`);
  }
}

const UUID_RE = new RegExp(UUID_PATTERN);
/** Query keys that carry entity ids (UUID columns). */
const UUID_QUERY_KEYS = [
  'institutionId',
  'academicPeriodId',
  'staffId',
  'sectionId',
  'bellScheduleId',
] as const;
const DATE_QUERY_KEYS = ['fromDate', 'toDate', 'date'] as const;
const SECTION_STATUSES = new Set(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

/** PRC-M407: list endpoints are always bounded (default 100, max 500). */
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
function listPageOf(request: FastifyRequest): { limit: number; offset: number } | null {
  const query = (request.query ?? {}) as { limit?: unknown; offset?: unknown };
  const limit = query.limit === undefined ? DEFAULT_LIST_LIMIT : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0) {
    return null;
  }
  return { limit: Math.min(limit, MAX_LIST_LIMIT), offset };
}
const SUBSTITUTION_STATUSES = new Set(['scheduled', 'completed', 'cancelled']);

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ code: 'VALIDATION_ERROR', message, statusCode: 400 });
}

/**
 * PRC-M399: validate every path param and known query param before handlers run, so a
 * malformed id/date/enum is a 400 instead of a Postgres cast error surfacing as 500.
 */
function paramAndQueryError(request: FastifyRequest): string | null {
  const params = (request.params ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      return `Path parameter ${key} must be a UUID`;
    }
  }
  const query = (request.query ?? {}) as Record<string, unknown>;
  for (const key of UUID_QUERY_KEYS) {
    const value = query[key];
    if (value !== undefined && (typeof value !== 'string' || !UUID_RE.test(value))) {
      return `Query parameter ${key} must be a UUID`;
    }
  }
  for (const key of DATE_QUERY_KEYS) {
    const value = query[key];
    if (value !== undefined && (typeof value !== 'string' || !isValidIsoDate(value))) {
      return `Query parameter ${key} must be a YYYY-MM-DD date`;
    }
  }
  if (query.dayOfWeek !== undefined) {
    const n = Number(query.dayOfWeek);
    if (!Number.isInteger(n) || n < 1 || n > 7) {
      return 'Query parameter dayOfWeek must be an integer 1-7';
    }
  }
  if (
    request.routeOptions?.url?.endsWith('/sections') &&
    query.status !== undefined &&
    (typeof query.status !== 'string' || !SECTION_STATUSES.has(query.status))
  ) {
    return 'Query parameter status must be DRAFT, PUBLISHED or ARCHIVED';
  }
  return null;
}

/** PRC-M399: map Postgres data/constraint errors to client errors instead of 500. */
function pgErrorStatus(error: unknown): { status: number; code: string; message: string } | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return null;
  if (code === '23505') {
    return { status: 409, code: 'CONFLICT', message: 'A record with these values already exists' };
  }
  if (code === '23503') {
    return {
      status: 409,
      code: 'CONFLICT',
      message: 'Referenced record does not exist or is in use',
    };
  }
  if (code.startsWith('23')) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Request violates a data constraint' };
  }
  if (code.startsWith('22')) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid value for a field' };
  }
  return null;
}

function sendDomainError(reply: FastifyReply, error: unknown) {
  if (isTimetableClashError(error)) {
    return reply.status(409).send(error.toJSON());
  }
  if (isTimetableVersionConflictError(error)) {
    return reply.status(409).send(error.toJSON());
  }
  if (isTimetableSchemaMissingError(error)) {
    return reply.status(503).send(error.toJSON());
  }
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  const mapped = pgErrorStatus(error);
  if (mapped) {
    return reply
      .status(mapped.status)
      .send({ code: mapped.code, message: mapped.message, statusCode: mapped.status });
  }
  throw error;
}

export async function registerTimetableRoutes(
  fastify: FastifyInstance,
  options: TimetableRoutesOptions,
): Promise<void> {
  const prefix = options.prefix ?? '/timetable';
  const { service } = options;

  fastify.addHook('preValidation', async (request, reply) => {
    const url = request.routeOptions?.url;
    if (!url || !url.startsWith(`${prefix}/`)) return;
    const problem = paramAndQueryError(request);
    if (problem) {
      await badRequest(reply, problem);
      return reply;
    }
    // PRC-M404: optimistic concurrency is mandatory on full-entity updates.
    if (request.method === 'PUT' && !ifMatchOf(request)) {
      await reply.status(428).send({
        code: 'PRECONDITION_REQUIRED',
        message: 'If-Match header with the entity ETag/updatedAt is required',
        statusCode: 428,
      });
      return reply;
    }
  });

  // ── Bell schedules ────────────────────────────────────────────────────────

  fastify.get(`${prefix}/bell-schedules`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as {
        institutionId?: string;
        academicPeriodId?: string;
      };
      const page = listPageOf(request);
      if (!page) return badRequest(reply, 'limit must be a positive integer and offset >= 0');
      const rows = await service.listBellSchedules(tenantId, {
        institutionId: query.institutionId,
        academicPeriodId: query.academicPeriodId,
        ...page,
      });
      return reply.send({ data: rows, page });
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
      const expectedUpdatedAt = ifMatchOf(request);
      const row = await service.updateBellSchedule(
        tenantId,
        id,
        validated.data,
        expectedUpdatedAt ? { expectedUpdatedAt } : undefined,
      );
      if (!row) {
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Bell schedule not found', statusCode: 404 });
      }
      setEtag(reply, row.updatedAt);
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
      const expectedUpdatedAt = ifMatchOf(request);
      const row = await service.updatePeriod(
        tenantId,
        id,
        validated.data,
        expectedUpdatedAt ? { expectedUpdatedAt } : undefined,
      );
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
      const page = listPageOf(request);
      if (!page) return badRequest(reply, 'limit must be a positive integer and offset >= 0');
      const rows = await service.listMeetings(tenantId, {
        institutionId: query.institutionId,
        academicPeriodId: query.academicPeriodId,
        staffId: query.staffId,
        sectionId: query.sectionId,
        ...page,
      });
      return reply.send({ data: rows, page });
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
      const expectedUpdatedAt = ifMatchOf(request);
      const row = await service.updateMeeting(
        tenantId,
        id,
        validated.data,
        expectedUpdatedAt ? { expectedUpdatedAt } : undefined,
      );
      if (!row) {
        return reply
          .status(404)
          .send({ code: 'NOT_FOUND', message: 'Meeting not found', statusCode: 404 });
      }
      setEtag(reply, row.updatedAt);
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
        status?: string;
      };
      const page = listPageOf(request);
      if (!page) return badRequest(reply, 'limit must be a positive integer and offset >= 0');
      if (
        query.status !== undefined &&
        (typeof query.status !== 'string' || !SUBSTITUTION_STATUSES.has(query.status.toLowerCase()))
      ) {
        return badRequest(reply, 'status must be scheduled, completed or cancelled');
      }
      const rows = await service.listSubstitutions(tenantId, {
        institutionId: query.institutionId,
        fromDate: query.fromDate,
        toDate: query.toDate,
        status: query.status,
        ...page,
      });
      return reply.send({ data: rows, page });
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
      const page = listPageOf(request);
      if (!page) return badRequest(reply, 'limit must be a positive integer and offset >= 0');
      const rows = await service.listRooms(tenantId, {
        institutionId: query.institutionId,
        ...page,
      });
      return reply.send({ data: rows, page });
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
      const page = listPageOf(request);
      if (!page) return badRequest(reply, 'limit must be a positive integer and offset >= 0');
      const rows = await service.listSections(tenantId, {
        institutionId: query.institutionId,
        academicPeriodId: query.academicPeriodId,
        status: query.status,
        ...page,
      });
      return reply.send({ data: rows, page });
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
      // PRC-M406: the roster (student ids) is staff-only; other readers get the schedule.
      const staff = hasTimetableAccess(requestRoles(request), 'schedule.read');
      const [enrollments, meetings] = await Promise.all([
        staff ? service.listEnrollments(tenantId, id) : Promise.resolve(undefined),
        service.listMeetings(tenantId, { sectionId: id }),
      ]);
      setEtag(reply, row.updatedAt);
      return reply.send(staff ? { ...row, enrollments, meetings } : { ...row, meetings });
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
      const expectedUpdatedAt = ifMatchOf(request);
      const row = await service.updateSection(
        tenantId,
        id,
        validated.data,
        expectedUpdatedAt ? { expectedUpdatedAt } : undefined,
      );
      if (!row) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Section not found',
          statusCode: 404,
        });
      }
      setEtag(reply, row.updatedAt);
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
    if (!requireAction(request, reply, 'schedule.read')) return;
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
      const expectedUpdatedAt = ifMatchOf(request);
      const row = await service.publishSection(
        tenantId,
        id,
        expectedUpdatedAt ? { expectedUpdatedAt } : undefined,
      );
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
      const expectedUpdatedAt = ifMatchOf(request);
      const row = await service.unpublishSection(
        tenantId,
        id,
        expectedUpdatedAt ? { expectedUpdatedAt } : undefined,
      );
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
    if (!requireAction(request, reply, 'schedule.read')) return;
    try {
      const query = request.query as { institutionId?: string; limit?: string; offset?: string };
      const limit = query.limit === undefined ? undefined : Number(query.limit);
      const offset = query.offset === undefined ? undefined : Number(query.offset);
      if (
        (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) ||
        (offset !== undefined && (!Number.isInteger(offset) || offset < 0))
      ) {
        return badRequest(reply, 'limit must be a positive integer and offset >= 0');
      }
      const rows = await service.listGenerationJobs(tenantId, {
        institutionId: query.institutionId,
        limit,
        offset,
      });
      return reply.send({
        data: rows,
        page: { limit: Math.min(limit ?? 50, 100), offset: offset ?? 0 },
      });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/generation-jobs/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'schedule.read')) return;
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
      // PRC-M401: `?async=true` queues the run and returns 202; poll GET /generation-jobs/:id.
      const runAsync = (request.query as { async?: string } | undefined)?.async === 'true';
      const row = await service.runGenerationJob(tenantId, validated.data, actor, {
        async: runAsync,
      });
      return reply.status(runAsync ? 202 : 201).send(row);
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
    if (!requireAction(request, reply, 'schedule.read')) return;
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
      // PRC-M406: clone writes sections/meetings — scheduler roles only, tenant first.
      const tenantId = tenantIdOf(request, reply);
      if (!tenantId) return;
      if (!requireAction(request, reply, 'schedule.write')) return;
      const sourcePeriodId = request.body?.sourcePeriodId;
      const targetPeriodId = request.body?.targetPeriodId;
      if (
        !sourcePeriodId ||
        !targetPeriodId ||
        !UUID_RE.test(sourcePeriodId) ||
        !UUID_RE.test(targetPeriodId)
      ) {
        return reply.code(400).send({
          code: 'VALIDATION_ERROR',
          message: 'sourcePeriodId and targetPeriodId are required UUIDs',
          statusCode: 400,
        });
      }
      const actorId = (request as { user?: { sub?: string } }).user?.sub ?? null;
      try {
        const result = await service.cloneForAcademicPeriod(
          tenantId,
          sourcePeriodId,
          targetPeriodId,
          { actorId },
        );
        return reply.code(201).send(result);
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
}
