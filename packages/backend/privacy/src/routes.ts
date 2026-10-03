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

import type { ListPage } from './privacy-repository.js';
import type { PrivacyRequestContext, PrivacyService } from './privacy-service.js';
import {
  CorrectionStatusEnum,
  CreateCorrectionRequestSchema,
  CreateErasureRequestSchema,
  ErasureStatusEnum,
  PlaceLegalHoldSchema,
  RequestTenantOffboardSchema,
} from './schemas.js';

export interface PrivacyRoutesOptions {
  privacyService: PrivacyService;
  /** Route prefix (default: `/privacy`). */
  prefix?: string;
}

const HttpPlaceLegalHoldSchema = Type.Omit(PlaceLegalHoldSchema, ['tenantId', 'placedBy']);

const HttpCreateErasureSchema = Type.Omit(CreateErasureRequestSchema, ['tenantId', 'requestedBy']);

const HttpCreateCorrectionSchema = Type.Omit(CreateCorrectionRequestSchema, [
  'tenantId',
  'requestedBy',
]);

const HttpOffboardSchema = Type.Omit(RequestTenantOffboardSchema, ['tenantId', 'requestedBy']);

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** PRC-L137: reject non-UUID `:id` before it reaches Postgres (22P02 -> 500). */
async function requireUuidIdParam(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const id = (request.params as { id?: unknown } | undefined)?.id;
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    await reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: 'Path parameter id must be a UUID',
      statusCode: 400,
    });
  }
}

/** PRC-L137: bounded list window (`limit` default 50, max 100; `offset` >= 0). */
function parseListPage(request: FastifyRequest, reply: FastifyReply): ListPage | null {
  const query = (request.query ?? {}) as { limit?: unknown; offset?: unknown };
  const limit = query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0) {
    void reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: 'limit must be a positive integer and offset a non-negative integer',
      statusCode: 400,
    });
    return null;
  }
  return { limit: Math.min(limit, MAX_PAGE_SIZE), offset };
}

function tenantIdOf(request: FastifyRequest): string | undefined {
  return (request as FastifyRequest & { tenantId?: string }).tenantId;
}

/**
 * PRC-M323: mutations require an authenticated subject; never attribute a privacy write to a
 * synthetic 'system' actor.
 */
function requireActor(request: FastifyRequest, reply: FastifyReply): string | null {
  const user = (request as FastifyRequest & { user?: { sub?: unknown } }).user;
  const sub = typeof user?.sub === 'string' ? user.sub.trim() : '';
  if (!sub) {
    void reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Authenticated user required',
      statusCode: 401,
    });
    return null;
  }
  return sub;
}

function contextOf(request: FastifyRequest): PrivacyRequestContext {
  return { ipAddress: request.ip };
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

  // PRC-H077: lets admin clients surface 'not implemented' erasure/offboard state.
  fastify.get(`${prefix}/capabilities`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    return reply.status(200).send({
      erasureExecutionAvailable: privacyService.erasureExecutionAvailable,
      tenantWipeAvailable: privacyService.tenantWipeAvailable,
    });
  });

  fastify.post(`${prefix}/legal-holds`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const actorId = requireActor(request, reply);
    if (!actorId) return;
    const parsed = validate(HttpPlaceLegalHoldSchema, request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    const body = parsed.data;
    try {
      const hold = await privacyService.placeLegalHold(
        {
          ...body,
          tenantId,
          placedBy: actorId,
        },
        contextOf(request),
      );
      return reply.status(201).send(formatHold(hold));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/legal-holds`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const page = parseListPage(request, reply);
    if (!page) return;
    const holds = await privacyService.listActiveLegalHolds(tenantId, page);
    return reply.send({ data: holds.map(formatHold), page });
  });

  fastify.post<{ Params: { id: string } }>(
    `${prefix}/legal-holds/:id/release`,
    { preValidation: requireUuidIdParam },
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const actorId = requireActor(request, reply);
      if (!actorId) return;
      try {
        const hold = await privacyService.releaseLegalHold(
          request.params.id,
          tenantId,
          actorId,
          contextOf(request),
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
    const actorId = requireActor(request, reply);
    if (!actorId) return;
    const parsed = validate(HttpCreateErasureSchema, request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    const body = parsed.data;
    try {
      const erasure = await privacyService.createErasureRequest(
        {
          ...body,
          tenantId,
          requestedBy: actorId,
        },
        contextOf(request),
      );
      return reply.status(201).send(formatErasure(erasure));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/erasure-requests`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const page = parseListPage(request, reply);
    if (!page) return;
    const rows = await privacyService.listErasureRequests(tenantId, page);
    return reply.send({ data: rows.map(formatErasure), page });
  });

  fastify.get<{ Params: { id: string } }>(
    `${prefix}/erasure-requests/:id`,
    { preValidation: requireUuidIdParam },
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
    { preValidation: requireUuidIdParam },
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const actorId = requireActor(request, reply);
      if (!actorId) return;
      const parsed = validate(TransitionBodySchema, request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: parsed.errors,
        });
      }
      const body = parsed.data;
      try {
        const row = await privacyService.transitionErasureRequest(
          request.params.id,
          tenantId,
          body.status,
          actorId,
          body.statusReason,
          contextOf(request),
        );
        return reply.send(formatErasure(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    `${prefix}/erasure-requests/:id/execute`,
    { preValidation: requireUuidIdParam },
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const actorId = requireActor(request, reply);
      if (!actorId) return;
      try {
        const row = await privacyService.executeErasure(
          request.params.id,
          tenantId,
          actorId,
          contextOf(request),
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
    const actorId = requireActor(request, reply);
    if (!actorId) return;
    const parsed = validate(HttpCreateCorrectionSchema, request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    const body = parsed.data;
    try {
      const row = await privacyService.createCorrectionRequest(
        {
          ...body,
          tenantId,
          requestedBy: actorId,
        },
        contextOf(request),
      );
      return reply.status(201).send(formatCorrection(row));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/correction-requests`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const page = parseListPage(request, reply);
    if (!page) return;
    const rows = await privacyService.listCorrectionRequests(tenantId, page);
    return reply.send({ data: rows.map(formatCorrection), page });
  });

  fastify.get<{ Params: { id: string } }>(
    `${prefix}/correction-requests/:id`,
    { preValidation: requireUuidIdParam },
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
    { preValidation: requireUuidIdParam },
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const actorId = requireActor(request, reply);
      if (!actorId) return;
      const parsed = validate(CorrectionTransitionBodySchema, request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: parsed.errors,
        });
      }
      const body = parsed.data;
      try {
        const row = await privacyService.transitionCorrectionRequest(
          request.params.id,
          tenantId,
          body.status,
          actorId,
          body.statusReason,
          contextOf(request),
        );
        return reply.send(formatCorrection(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    `${prefix}/correction-requests/:id/apply`,
    { preValidation: requireUuidIdParam },
    async (request, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const actorId = requireActor(request, reply);
      if (!actorId) return;
      try {
        const row = await privacyService.applyCorrection(
          request.params.id,
          tenantId,
          actorId,
          undefined,
          contextOf(request),
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
    const actorId = requireActor(request, reply);
    if (!actorId) return;
    const parsed = validate(HttpOffboardSchema, request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    const body = parsed.data;
    try {
      const job = await privacyService.requestTenantOffboardWipe(
        {
          ...body,
          tenantId,
          requestedBy: actorId,
        },
        contextOf(request),
      );
      return reply.status(201).send(formatOffboard(job));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/tenant-offboard`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const page = parseListPage(request, reply);
    if (!page) return;
    const rows = await privacyService.listTenantOffboardJobs(tenantId, page);
    return reply.send({ data: rows.map(formatOffboard), page });
  });

  fastify.get<{ Params: { id: string } }>(
    `${prefix}/tenant-offboard/:id`,
    { preValidation: requireUuidIdParam },
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
