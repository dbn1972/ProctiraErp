/**
 * G-905 — academic calendar routes (mounted under the academic-periods prefix).
 *
 * GET    /academic-periods/:id/calendar            - List events for a period
 * POST   /academic-periods/:id/calendar            - Add a holiday / break / window
 * DELETE /academic-periods/:id/calendar/:eventId   - Remove an event
 * POST   /academic-periods/:id/rollover            - Dry-run / execute year-end rollover
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AcademicCalendarService } from './calendar-service.js';
import type { CalendarEventRecord } from './calendar-store.js';
import {
  CreateCalendarEventSchema,
  RolloverRequestSchema,
  type CreateCalendarEventDto,
  type RolloverRequestDto,
  type RolloverSummary,
} from './schemas.js';

export interface AcademicCalendarRoutesOptions {
  service: AcademicCalendarService;
  /** Academic-period prefix (default '/academic-periods'). */
  prefix?: string;
}

function tenantOf(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

interface RequestUser {
  sub: string;
  displayName?: string;
  email?: string;
}

/** Validated JWT subject of the caller, or null when unauthenticated. */
function actorOf(request: FastifyRequest): RequestUser | null {
  const user = (request as FastifyRequest & { user?: Partial<RequestUser> }).user;
  const sub = typeof user?.sub === 'string' ? user.sub.trim() : '';
  if (!sub || sub.length > 128) return null;
  return { sub, displayName: user?.displayName, email: user?.email };
}

interface RolloverAuditRecorder {
  recordAudit: (input: {
    tenantId: string;
    entityType: string;
    entityId: string;
    operation: 'UPDATE';
    userId: string;
    userName: string;
    ipAddress: string;
    beforeValues: Record<string, unknown>;
    afterValues: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }) => Promise<unknown>;
}

/**
 * PRC-L319: explicit audit event for an executed (non-dry-run) rollover with the
 * summary counts. Skipped when no audit service is decorated (package tests);
 * an audit failure is logged and does not hide the completed rollover.
 */
async function recordRolloverAudit(
  fastify: FastifyInstance,
  request: FastifyRequest,
  tenantId: string,
  user: RequestUser,
  summary: RolloverSummary,
): Promise<void> {
  const audit = (fastify as FastifyInstance & { auditService?: RolloverAuditRecorder })
    .auditService;
  if (!audit?.recordAudit) return;
  try {
    await audit.recordAudit({
      tenantId,
      entityType: 'academic_period',
      entityId: summary.targetPeriodId,
      operation: 'UPDATE',
      userId: user.sub,
      userName: user.displayName ?? user.email ?? user.sub,
      ipAddress: request.ip || '0.0.0.0',
      beforeValues: { sourcePeriodId: summary.sourcePeriodId },
      afterValues: {
        classes: summary.classes,
        enrollments: summary.enrollments,
        feeStructures: summary.feeStructures,
        timetable: summary.timetable,
        lmsAssignments: summary.lmsAssignments,
      },
      metadata: {
        action: 'academic_period.rollover',
        actorId: user.sub,
        sourcePeriodId: summary.sourcePeriodId,
        targetPeriodId: summary.targetPeriodId,
      },
    });
  } catch (error: unknown) {
    request.log.error({ err: error }, 'academic period rollover audit failed');
  }
}

function formatEvent(event: CalendarEventRecord) {
  return { ...event, createdAt: event.createdAt.toISOString() };
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

export async function registerAcademicCalendarRoutes(
  fastify: FastifyInstance,
  options: AcademicCalendarRoutesOptions,
): Promise<void> {
  const { service, prefix = '/academic-periods' } = options;

  fastify.get(
    `${prefix}/:id/calendar`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      try {
        const events = await service.listEvents(tenantId, request.params.id);
        return reply.status(200).send({ data: events.map(formatEvent) });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/calendar`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: CreateCalendarEventDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      const body = validate(CreateCalendarEventSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid calendar event',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const event = await service.addEvent(tenantId, request.params.id, body.data);
        return reply.status(201).send(formatEvent(event));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    `${prefix}/:id/calendar/:eventId`,
    async (
      request: FastifyRequest<{ Params: { id: string; eventId: string } }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      try {
        await service.removeEvent(tenantId, request.params.id, request.params.eventId);
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/rollover`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: RolloverRequestDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      // PRC-L319: the rollover is attributed to the authenticated caller.
      const user = actorOf(request);
      if (!user) {
        return reply.status(401).send({
          code: 'UNAUTHORIZED',
          message: 'Authenticated user is required',
          statusCode: 401,
        });
      }
      const body = validate(RolloverRequestSchema, request.body ?? {});
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid rollover request',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const summary = await service.rollover(tenantId, request.params.id, body.data, user.sub);
        if (!summary.dryRun) await recordRolloverAudit(fastify, request, tenantId, user, summary);
        return reply.status(200).send(summary);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
