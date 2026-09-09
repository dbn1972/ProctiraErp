/**
 * G-919 ops routes under `/attendance`.
 *
 * POST/GET  /attendance/regularisation
 * POST      /attendance/regularisation/:id/approve|reject
 * POST/GET  /attendance/leave-requests
 * POST      /attendance/leave-requests/:id/approve|reject
 * POST      /attendance/devices
 * POST      /attendance/ingest
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  CreateLeaveRequestSchema,
  CreateRegularisationSchema,
  DecideRequestSchema,
  IngestBatchSchema,
  RegisterDeviceSchema,
} from './ops-schemas.js';
import type { AttendanceOpsService, OpsActor } from './ops-service.js';

export interface AttendanceOpsRoutesOptions {
  opsService: AttendanceOpsService;
  prefix?: string;
}

function tenantIdOf(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const tenantId =
    (request as FastifyRequest & { tenantId?: string }).tenantId ??
    (request as FastifyRequest & { user?: { tenantId?: string } }).user?.tenantId ??
    (request.headers['x-tenant-id'] as string | undefined);
  if (!tenantId) {
    reply.status(400).send({
      code: 'TENANT_REQUIRED',
      message: 'Tenant context is required',
      statusCode: 400,
    });
    return undefined;
  }
  return tenantId;
}

function actorOf(request: FastifyRequest): OpsActor {
  const user = request as FastifyRequest & {
    user?: { sub?: string; userId?: string; roles?: unknown };
  };
  const rolesRaw = user.user?.roles ?? [];
  const roles = Array.isArray(rolesRaw)
    ? rolesRaw.map((r) => {
        if (typeof r === 'string') return r;
        if (r && typeof r === 'object') {
          const obj = r as { roleName?: string; roleId?: string };
          return String(obj.roleName ?? obj.roleId ?? '');
        }
        return '';
      })
    : [];
  return {
    userId: user.user?.sub ?? user.user?.userId ?? 'system',
    roles,
  };
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

export async function registerAttendanceOpsRoutes(
  fastify: FastifyInstance,
  options: AttendanceOpsRoutesOptions,
): Promise<void> {
  const prefix = options.prefix ?? '/attendance';
  const { opsService } = options;

  fastify.get(`${prefix}/regularisation`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as { status?: 'requested' | 'approved' | 'rejected' };
      const rows = await opsService.listRegularisations(tenantId, query.status);
      return reply.send({ data: rows });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/regularisation`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(CreateRegularisationSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await opsService.requestRegularisation(tenantId, validated.data, actorOf(request));
      return reply.status(201).send(row);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  for (const decision of ['approve', 'reject'] as const) {
    fastify.post(`${prefix}/regularisation/:id/${decision}`, async (request, reply) => {
      const tenantId = tenantIdOf(request, reply);
      if (!tenantId) return;
      const validated = validate(DecideRequestSchema, request.body ?? {});
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
        const row = await opsService.decideRegularisation(
          tenantId,
          id,
          decision === 'approve' ? 'approved' : 'rejected',
          actorOf(request),
          validated.data.decisionNote,
        );
        return reply.send(row);
      } catch (error) {
        return sendError(reply, error);
      }
    });
  }

  fastify.get(`${prefix}/leave-requests`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as { status?: 'requested' | 'approved' | 'rejected' };
      const rows = await opsService.listLeaves(tenantId, query.status);
      return reply.send({ data: rows });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/leave-requests`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(CreateLeaveRequestSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await opsService.requestLeave(tenantId, validated.data, actorOf(request));
      return reply.status(201).send(row);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  for (const decision of ['approve', 'reject'] as const) {
    fastify.post(`${prefix}/leave-requests/:id/${decision}`, async (request, reply) => {
      const tenantId = tenantIdOf(request, reply);
      if (!tenantId) return;
      const validated = validate(DecideRequestSchema, request.body ?? {});
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
        const row = await opsService.decideLeave(
          tenantId,
          id,
          decision === 'approve' ? 'approved' : 'rejected',
          actorOf(request),
          validated.data.decisionNote,
        );
        return reply.send(row);
      } catch (error) {
        return sendError(reply, error);
      }
    });
  }

  fastify.post(`${prefix}/devices`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(RegisterDeviceSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await opsService.registerDevice(tenantId, validated.data, actorOf(request));
      return reply.status(201).send(row);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/ingest`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(IngestBatchSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const header = request.headers['x-device-api-key'];
      const apiKey = Array.isArray(header) ? header[0] : header;
      const result = await opsService.ingest(tenantId, apiKey, validated.data);
      return reply.status(202).send(result);
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
