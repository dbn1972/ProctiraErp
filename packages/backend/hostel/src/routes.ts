import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HostelService } from './hostel-service.js';

export interface HostelRoutesOptions {
  service: HostelService;
  prefix?: string;
}

type RequestWithUser = FastifyRequest & { user?: { tenantId?: string } };

function tenantIdOf(request: FastifyRequest): string {
  const user = (request as RequestWithUser).user;
  return (
    user?.tenantId ??
    (request.headers['x-tenant-id'] as string | undefined) ??
    '00000000-0000-4000-8000-000000000001'
  );
}

export async function registerHostelRoutes(
  fastify: FastifyInstance,
  options: HostelRoutesOptions,
) {
  const prefix = options.prefix ?? '/hostels';
  const { service } = options;

  fastify.get(`${prefix}`, async (request, reply) => {
    const rows = await service.listHostels(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getHostel(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}`, async (request, reply) => {
    const row = await service.createHostel(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateHostel(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/rooms`, async (request, reply) => {
    const rows = await service.listHostelRooms(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/rooms/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getHostelRoom(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/rooms`, async (request, reply) => {
    const row = await service.createHostelRoom(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/rooms/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateHostelRoom(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/allocations`, async (request, reply) => {
    const rows = await service.listHostelAllocations(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/allocations/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getHostelAllocation(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/allocations`, async (request, reply) => {
    const row = await service.createHostelAllocation(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/allocations/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateHostelAllocation(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

}
