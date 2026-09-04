import type { FastifyInstance, FastifyRequest } from 'fastify';
import { TimetableService } from './timetable-service.js';

export interface TimetableRoutesOptions {
  service: TimetableService;
  prefix?: string;
}

function tenantIdOf(request: FastifyRequest): string {
  const user = request.user as { tenantId?: string } | undefined;
  return (
    user?.tenantId ??
    (request.headers['x-tenant-id'] as string | undefined) ??
    '00000000-0000-4000-8000-000000000001'
  );
}

export async function registerTimetableRoutes(
  fastify: FastifyInstance,
  options: TimetableRoutesOptions,
) {
  const prefix = options.prefix ?? '/timetables';
  const { service } = options;

  fastify.get(`${prefix}/periods`, async (request, reply) => {
    const rows = await service.listBellPeriods(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/periods/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getBellPeriod(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/periods`, async (request, reply) => {
    const row = await service.createBellPeriod(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/periods/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateBellPeriod(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/slots`, async (request, reply) => {
    const rows = await service.listTimetableSlots(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/slots/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getTimetableSlot(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/slots`, async (request, reply) => {
    const row = await service.createTimetableSlot(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/slots/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateTimetableSlot(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/substitutions`, async (request, reply) => {
    const rows = await service.listSubstitutions(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/substitutions/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getSubstitution(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/substitutions`, async (request, reply) => {
    const row = await service.createSubstitution(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/substitutions/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateSubstitution(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

}
