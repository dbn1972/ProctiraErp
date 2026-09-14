/**
 * Privacy lifecycle HTTP routes (W1-ARCH-05 composition + W1-SEC-06 residual).
 *
 * POST   /privacy/legal-holds
 * GET    /privacy/legal-holds
 * POST   /privacy/legal-holds/:id/release
 * POST   /privacy/erasure-requests
 * GET    /privacy/erasure-requests
 * GET    /privacy/erasure-requests/:id
 * POST   /privacy/erasure-requests/:id/transition
 * POST   /privacy/erasure-requests/:id/execute
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { PrivacyService } from './privacy-service.js';
import {
  CreateErasureRequestSchema,
  ErasureStatusEnum,
  PlaceLegalHoldSchema,
  type ErasureStatus,
} from './schemas.js';

export interface PrivacyRoutesOptions {
  privacyService: PrivacyService;
  /** Route prefix (default: `/privacy`). */
  prefix?: string;
}

const HttpPlaceLegalHoldSchema = Type.Omit(PlaceLegalHoldSchema, ['tenantId', 'placedBy']);
type HttpPlaceLegalHold = Static<typeof HttpPlaceLegalHoldSchema>;

const HttpCreateErasureSchema = Type.Omit(CreateErasureRequestSchema, ['tenantId', 'requestedBy']);
type HttpCreateErasure = Static<typeof HttpCreateErasureSchema>;

const TransitionBodySchema = Type.Object({
  status: ErasureStatusEnum,
  statusReason: Type.Optional(Type.String({ maxLength: 2000 })),
});
type TransitionBody = Static<typeof TransitionBodySchema>;

function tenantIdOf(request: FastifyRequest): string | undefined {
  return (request as FastifyRequest & { tenantId?: string }).tenantId;
}

function actorIdOf(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string } }).user;
  return user?.sub ?? 'system';
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    });
  }
  throw error;
}

function formatHold(entity: {
  id: string;
  tenantId: string;
  scope: string;
  subjectType: string | null;
  subjectId: string | null;
  reason: string;
  placedBy: string;
  placedAt: Date;
  releasedBy: string | null;
  releasedAt: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    scope: entity.scope,
    subjectType: entity.subjectType,
    subjectId: entity.subjectId,
    reason: entity.reason,
    placedBy: entity.placedBy,
    placedAt: entity.placedAt.toISOString(),
    releasedBy: entity.releasedBy,
    releasedAt: entity.releasedAt?.toISOString() ?? null,
    active: entity.active,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatErasure(entity: {
  id: string;
  tenantId: string;
  subjectType: string;
  subjectId: string;
  status: string;
  requestType: string;
  reason: string | null;
  requestedBy: string;
  reviewedBy: string | null;
  statusReason: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    subjectType: entity.subjectType,
    subjectId: entity.subjectId,
    status: entity.status,
    requestType: entity.requestType,
    reason: entity.reason,
    requestedBy: entity.requestedBy,
    reviewedBy: entity.reviewedBy,
    statusReason: entity.statusReason,
    completedAt: entity.completedAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export async function registerPrivacyRoutes(
  fastify: FastifyInstance,
  options: PrivacyRoutesOptions,
): Promise<void> {
  const { privacyService, prefix = '/privacy' } = options;

  fastify.post(`${prefix}/legal-holds`, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const parsed = validate(HttpPlaceLegalHoldSchema, request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    const body = parsed.data as HttpPlaceLegalHold;
    try {
      const hold = await privacyService.placeLegalHold({
        ...body,
        tenantId,
        placedBy: actorIdOf(request),
      });
      return reply.status(201).send(formatHold(hold));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/legal-holds`, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const holds = await privacyService.listActiveLegalHolds(tenantId);
    return reply.send({ data: holds.map(formatHold) });
  });

  fastify.post<{ Params: { id: string } }>(
    `${prefix}/legal-holds/:id/release`,
    async (request, reply) => {
      try {
        const hold = await privacyService.releaseLegalHold(request.params.id, actorIdOf(request));
        return reply.send(formatHold(hold));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(`${prefix}/erasure-requests`, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const parsed = validate(HttpCreateErasureSchema, request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    const body = parsed.data as HttpCreateErasure;
    try {
      const erasure = await privacyService.createErasureRequest({
        ...body,
        tenantId,
        requestedBy: actorIdOf(request),
      });
      return reply.status(201).send(formatErasure(erasure));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/erasure-requests`, async (request, reply) => {
    const tenantId = tenantIdOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const rows = await privacyService.listErasureRequests(tenantId);
    return reply.send({ data: rows.map(formatErasure) });
  });

  fastify.get<{ Params: { id: string } }>(
    `${prefix}/erasure-requests/:id`,
    async (request, reply) => {
      const row = await privacyService.getErasureRequest(request.params.id);
      if (!row) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: `Erasure request '${request.params.id}' not found`,
          statusCode: 404,
        });
      }
      return reply.send(formatErasure(row));
    },
  );

  fastify.post<{ Params: { id: string }; Body: TransitionBody }>(
    `${prefix}/erasure-requests/:id/transition`,
    async (request, reply) => {
      const parsed = validate(TransitionBodySchema, request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: parsed.errors,
        });
      }
      const body = parsed.data as TransitionBody;
      try {
        const row = await privacyService.transitionErasureRequest(
          request.params.id,
          body.status as ErasureStatus,
          actorIdOf(request),
          body.statusReason,
        );
        return reply.send(formatErasure(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    `${prefix}/erasure-requests/:id/execute`,
    async (request, reply) => {
      try {
        const row = await privacyService.executeErasure(request.params.id, actorIdOf(request));
        return reply.send(formatErasure(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
