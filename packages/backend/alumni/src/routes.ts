import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AlumniService } from './alumni-service.js';

export interface AlumniRoutesOptions {
  service: AlumniService;
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

export async function registerAlumniRoutes(
  fastify: FastifyInstance,
  options: AlumniRoutesOptions,
) {
  const prefix = options.prefix ?? '/alumni';
  const { service } = options;

  fastify.get(`${prefix}/profiles`, async (request, reply) => {
    const rows = await service.listAlumniProfiles(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/profiles/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getAlumniProfile(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/profiles`, async (request, reply) => {
    const row = await service.createAlumniProfile(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/profiles/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateAlumniProfile(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/events`, async (request, reply) => {
    const rows = await service.listAlumniEvents(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/events/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getAlumniEvent(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/events`, async (request, reply) => {
    const row = await service.createAlumniEvent(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/events/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateAlumniEvent(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

}
