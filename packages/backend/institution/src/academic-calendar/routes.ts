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
} from './schemas.js';

export interface AcademicCalendarRoutesOptions {
  service: AcademicCalendarService;
  /** Academic-period prefix (default '/academic-periods'). */
  prefix?: string;
}

function tenantOf(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
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
        return reply
          .status(400)
          .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
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
        return reply
          .status(400)
          .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
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
        return reply
          .status(400)
          .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
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
        return reply
          .status(400)
          .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
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
        const summary = await service.rollover(tenantId, request.params.id, body.data);
        return reply.status(200).send(summary);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
