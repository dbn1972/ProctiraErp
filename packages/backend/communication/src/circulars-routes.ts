/**
 * Circular + delivery-log routes (G-922).
 *
 * GET/POST /communication/circulars
 * GET      /communication/circulars/:id
 * POST     /communication/circulars/:id/send
 * POST     /communication/circulars/:id/ack
 * GET      /communication/delivery-log
 * POST     /communication/delivery-log/:id/retry
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  AckCircularSchema,
  CircularParamsSchema,
  CreateCircularSchema,
  DeliveryLogParamsSchema,
  DeliveryLogQuerySchema,
  type AckCircularInput,
  type CircularParams,
  type CreateCircularInput,
  type DeliveryLogParams,
  type DeliveryLogQuery,
} from './circular-schemas.js';
import type { CircularsService } from './circulars-service.js';

export interface CircularRoutesOptions {
  circularsService: CircularsService;
  prefix?: string;
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function tenantRequired(reply: FastifyReply) {
  return reply.status(400).send({
    code: 'TENANT_REQUIRED',
    message: 'Tenant context is required',
    statusCode: 400,
  });
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function formatCircular(entity: {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  audienceType: string;
  audienceJson: Record<string, unknown>;
  requiresAck: boolean;
  channels: string[];
  status: string;
  createdBy: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ackTotal: number;
  ackCount: number;
  ackRate: number;
  acks: Array<{
    id: string;
    recipientId: string;
    recipientLabel: string | null;
    acknowledgedAt: Date | null;
  }>;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    title: entity.title,
    body: entity.body,
    audienceType: entity.audienceType,
    audienceJson: entity.audienceJson,
    requiresAck: entity.requiresAck,
    channels: entity.channels,
    status: entity.status,
    createdBy: entity.createdBy,
    sentAt: iso(entity.sentAt),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    ackTotal: entity.ackTotal,
    ackCount: entity.ackCount,
    ackRate: entity.ackRate,
    acks: entity.acks.map((ack) => ({
      id: ack.id,
      recipientId: ack.recipientId,
      recipientLabel: ack.recipientLabel,
      acknowledgedAt: iso(ack.acknowledgedAt),
    })),
  };
}

function formatLog(entity: {
  id: string;
  tenantId: string;
  channel: string;
  recipientId: string;
  recipientLabel: string | null;
  status: string;
  providerRef: string | null;
  sourceType: string;
  sourceId: string | null;
  errorMessage: string | null;
  queuedAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  retriedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    channel: entity.channel,
    recipientId: entity.recipientId,
    recipientLabel: entity.recipientLabel,
    status: entity.status,
    providerRef: entity.providerRef,
    sourceType: entity.sourceType,
    sourceId: entity.sourceId,
    errorMessage: entity.errorMessage,
    queuedAt: entity.queuedAt.toISOString(),
    sentAt: iso(entity.sentAt),
    deliveredAt: iso(entity.deliveredAt),
    failedAt: iso(entity.failedAt),
    retriedAt: iso(entity.retriedAt),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export async function registerCircularRoutes(
  fastify: FastifyInstance,
  options: CircularRoutesOptions,
): Promise<void> {
  const { circularsService, prefix = '/communication' } = options;

  fastify.get(
    `${prefix}/circulars`,
    async function listCircularsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const rows = await circularsService.listCirculars(tenantId);
      return reply.status(200).send({ data: rows.map(formatCircular) });
    },
  );

  fastify.post(
    `${prefix}/circulars`,
    async function createCircularHandler(
      request: FastifyRequest<{ Body: CreateCircularInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateCircularSchema, request.body);
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
        const row = await circularsService.createCircular(tenantId, result.data);
        return reply.status(201).send(formatCircular(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/circulars/:id`,
    async function getCircularHandler(
      request: FastifyRequest<{ Params: CircularParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CircularParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid circular ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const row = await circularsService.getCircular(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatCircular(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/circulars/:id/send`,
    async function sendCircularHandler(
      request: FastifyRequest<{ Params: CircularParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CircularParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid circular ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const row = await circularsService.sendCircular(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatCircular(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/circulars/:id/ack`,
    async function ackCircularHandler(
      request: FastifyRequest<{ Params: CircularParams; Body: AckCircularInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CircularParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid circular ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const bodyResult = validate(AckCircularSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const row = await circularsService.ackCircular(
          tenantId,
          paramsResult.data.id,
          bodyResult.data.recipientId,
        );
        return reply.status(200).send(formatCircular(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/delivery-log`,
    async function listDeliveryLogHandler(
      request: FastifyRequest<{ Querystring: DeliveryLogQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const result = validate(DeliveryLogQuerySchema, request.query ?? {});
      const filter = result.success ? result.data : {};
      const rows = await circularsService.listDeliveryLogs(tenantId, filter);
      return reply.status(200).send({ data: rows.map(formatLog) });
    },
  );

  fastify.post(
    `${prefix}/delivery-log/:id/retry`,
    async function retryDeliveryHandler(
      request: FastifyRequest<{ Params: DeliveryLogParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeliveryLogParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid delivery log ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const row = await circularsService.retryFailed(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatLog(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );
}
