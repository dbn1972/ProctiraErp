import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TimetableService } from './timetable-service.js';
import { isTimetableClashError } from './timetable-clash-error.js';

export interface TimetableRoutesOptions {
  service: TimetableService;
  prefix?: string;
}

function tenantIdOf(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  const tenantId =
    user?.tenantId ?? (request.headers['x-tenant-id'] as string | undefined);
  if (!tenantId) {
    reply.status(401).send({
      error: 'unauthorized',
      message: 'Tenant context required (user.tenantId or x-tenant-id)',
    });
    return undefined;
  }
  return tenantId;
}

function sendClash(reply: FastifyReply, error: unknown) {
  if (isTimetableClashError(error)) {
    const body =
      typeof (error as { toJSON?: () => unknown }).toJSON === 'function'
        ? (error as { toJSON: () => unknown }).toJSON()
        : {
            code: 'TIMETABLE_CLASH',
            message: String((error as Error).message ?? 'Timetable clash'),
            conflicts: (error as { conflicts?: unknown[] }).conflicts ?? [],
          };
    return reply.status(409).send(body);
  }
  throw error;
}

export async function registerTimetableRoutes(
  fastify: FastifyInstance,
  options: TimetableRoutesOptions,
) {
  const prefix = options.prefix ?? '/timetables';
  const { service } = options;

  fastify.get(`${prefix}/periods`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const rows = await service.listBellPeriods(tenantId);
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/periods/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.getBellPeriod(tenantId, id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/periods`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const row = await service.createBellPeriod(tenantId, request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/periods/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.updateBellPeriod(tenantId, id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/slots`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const rows = await service.listTimetableSlots(tenantId);
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/slots/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.getTimetableSlot(tenantId, id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/slots`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const row = await service.createTimetableSlot(tenantId, request.body as any);
      return reply.status(201).send(row);
    } catch (error) {
      return sendClash(reply, error);
    }
  });
  fastify.put(`${prefix}/slots/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    try {
      const row = await service.updateTimetableSlot(tenantId, id, request.body as any);
      if (!row) return reply.status(404).send({ error: 'not_found' });
      return reply.send(row);
    } catch (error) {
      return sendClash(reply, error);
    }
  });

  fastify.get(`${prefix}/substitutions`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const rows = await service.listSubstitutions(tenantId);
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/substitutions/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.getSubstitution(tenantId, id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/substitutions`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const row = await service.createSubstitution(tenantId, request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/substitutions/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.updateSubstitution(tenantId, id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
}
