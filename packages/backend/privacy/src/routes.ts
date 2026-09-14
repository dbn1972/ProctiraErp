/**
 * Privacy lifecycle HTTP routes (W1-ARCH-05 + W1-SEC-06 complete).
 *
 * POST   /privacy/legal-holds
 * GET    /privacy/legal-holds
 * POST   /privacy/legal-holds/:id/release
 * POST   /privacy/erasure-requests
 * GET    /privacy/erasure-requests
 * GET    /privacy/erasure-requests/:id
 * POST   /privacy/erasure-requests/:id/transition
 * POST   /privacy/erasure-requests/:id/execute
 * POST   /privacy/correction-requests
 * GET    /privacy/correction-requests
 * GET    /privacy/correction-requests/:id
 * POST   /privacy/correction-requests/:id/transition
 * POST   /privacy/correction-requests/:id/apply
 * POST   /privacy/tenant-offboard
 * GET    /privacy/tenant-offboard
 * GET    /privacy/tenant-offboard/:id
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { PrivacyService } from './privacy-service.js';
import {
  CorrectionStatusEnum,
  CreateCorrectionRequestSchema,
  CreateErasureRequestSchema,
  ErasureStatusEnum,
  PlaceLegalHoldSchema,
  RequestTenantOffboardSchema,
  type CorrectionStatus,
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

const HttpCreateCorrectionSchema = Type.Omit(CreateCorrectionRequestSchema, [
  'tenantId',
  'requestedBy',
]);
type HttpCreateCorrection = Static<typeof HttpCreateCorrectionSchema>;

const HttpOffboardSchema = Type.Omit(RequestTenantOffboardSchema, ['tenantId', 'requestedBy']);
type HttpOffboard = Static<typeof HttpOffboardSchema>;

const TransitionBodySchema = Type.Object({
  status: ErasureStatusEnum,
  statusReason: Type.Optional(Type.String({ maxLength: 2000 })),
});
type TransitionBody = Static<typeof TransitionBodySchema>;

const CorrectionTransitionBodySchema = Type.Object({
  status: CorrectionStatusEnum,
  statusReason: Type.Optional(Type.String({ maxLength: 2000 })),
});
type CorrectionTransitionBody = Static<typeof CorrectionTransitionBodySchema>;

function tenantIdOf(request: FastifyRequest): string | undefined {
  return (request as FastifyRequest & { tenantId?: string }).tenantId;
}

function actorIdOf(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string } }).user;
  return user?.sub ?? 'system';
}

function requireTenant(request: FastifyRequest, reply: FastifyReply): string | null {
  const tenantId = tenantIdOf(request);
  if (!tenantId) {
    void reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Tenant context required',
      statusCode: 401,
    });
    return null;
  }
  return tenantId;
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

function formatCorrection(entity: {
  id: string;
  tenantId: string;
  subjectType: string;
  subjectId: string;
  fieldPath: string;
  currentValue: string | null;
  requestedValue: string;
  reason: string | null;
  status: string;
  requestedBy: string;
  reviewedBy: string | null;
  statusReason: string | null;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    subjectType: entity.subjectType,
    subjectId: entity.subjectId,
    fieldPath: entity.fieldPath,
    currentValue: entity.currentValue,
    requestedValue: entity.requestedValue,
    reason: entity.reason,
    status: entity.status,
    requestedBy: entity.requestedBy,
    reviewedBy: entity.reviewedBy,
    statusReason: entity.statusReason,
    appliedAt: entity.appliedAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatOffboard(entity: {
  id: string;
  tenantId: string;
  status: string;
  reason: string;
  requestedBy: string;
  statusReason: string | null;
  checklist: Array<{ domain: string; status: string; note?: string }>;
  residualNote: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    status: entity.status,
    reason: entity.reason,
    requestedBy: entity.requestedBy,
    statusReason: entity.statusReason,
    checklist: entity.checklist,
    residualNote: entity.residualNote,
    startedAt: entity.startedAt?.toISOString() ?? null,
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
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
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
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const holds = await privacyService.listActiveLegalHolds(tenantId);
    return reply.send({ data: holds.map(formatHold) });
  });

  fastify.post<{ Params: { id: string } }>(
    `${prefix}/legal-holds/:id/release`,
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      try {
        const hold = await privacyService.releaseLegalHold(
          request.params.id,
          tenantId,
          actorIdOf(request),
        );
        return reply.send(formatHold(hold));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(`${prefix}/erasure-requests`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
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
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const rows = await privacyService.listErasureRequests(tenantId);
    return reply.send({ data: rows.map(formatErasure) });
  });

  fastify.get<{ Params: { id: string } }>(
    `${prefix}/erasure-requests/:id`,
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const row = await privacyService.getErasureRequest(request.params.id, tenantId);
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
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
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
          tenantId,
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
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      try {
        const row = await privacyService.executeErasure(
          request.params.id,
          tenantId,
          actorIdOf(request),
        );
        return reply.send(formatErasure(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Correction ──────────────────────────────────────────────────────────

  fastify.post(`${prefix}/correction-requests`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const parsed = validate(HttpCreateCorrectionSchema, request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    const body = parsed.data as HttpCreateCorrection;
    try {
      const row = await privacyService.createCorrectionRequest({
        ...body,
        tenantId,
        requestedBy: actorIdOf(request),
      });
      return reply.status(201).send(formatCorrection(row));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/correction-requests`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const rows = await privacyService.listCorrectionRequests(tenantId);
    return reply.send({ data: rows.map(formatCorrection) });
  });

  fastify.get<{ Params: { id: string } }>(
    `${prefix}/correction-requests/:id`,
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const row = await privacyService.getCorrectionRequest(request.params.id, tenantId);
      if (!row) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: `Correction request '${request.params.id}' not found`,
          statusCode: 404,
        });
      }
      return reply.send(formatCorrection(row));
    },
  );

  fastify.post<{ Params: { id: string }; Body: CorrectionTransitionBody }>(
    `${prefix}/correction-requests/:id/transition`,
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const parsed = validate(CorrectionTransitionBodySchema, request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: parsed.errors,
        });
      }
      const body = parsed.data as CorrectionTransitionBody;
      try {
        const row = await privacyService.transitionCorrectionRequest(
          request.params.id,
          tenantId,
          body.status as CorrectionStatus,
          actorIdOf(request),
          body.statusReason,
        );
        return reply.send(formatCorrection(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    `${prefix}/correction-requests/:id/apply`,
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      try {
        const row = await privacyService.applyCorrection(
          request.params.id,
          tenantId,
          actorIdOf(request),
        );
        return reply.send(formatCorrection(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Tenant offboard ─────────────────────────────────────────────────────

  fastify.post(`${prefix}/tenant-offboard`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const parsed = validate(HttpOffboardSchema, request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    const body = parsed.data as HttpOffboard;
    try {
      const job = await privacyService.requestTenantOffboardWipe({
        ...body,
        tenantId,
        requestedBy: actorIdOf(request),
      });
      return reply.status(201).send(formatOffboard(job));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/tenant-offboard`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const rows = await privacyService.listTenantOffboardJobs(tenantId);
    return reply.send({ data: rows.map(formatOffboard) });
  });

  fastify.get<{ Params: { id: string } }>(
    `${prefix}/tenant-offboard/:id`,
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const row = await privacyService.getTenantOffboardJob(request.params.id, tenantId);
      if (!row) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: `Tenant offboard job '${request.params.id}' not found`,
          statusCode: 404,
        });
      }
      return reply.send(formatOffboard(row));
    },
  );
}
