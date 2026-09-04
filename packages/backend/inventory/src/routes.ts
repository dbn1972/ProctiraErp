import type { FastifyInstance, FastifyRequest } from 'fastify';
import { InventoryService } from './inventory-service.js';

export interface InventoryRoutesOptions {
  service: InventoryService;
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

export async function registerInventoryRoutes(
  fastify: FastifyInstance,
  options: InventoryRoutesOptions,
) {
  const prefix = options.prefix ?? '/inventory';
  const { service } = options;

  fastify.get(`${prefix}/items`, async (request, reply) => {
    const rows = await service.listInventoryItems(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/items/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getInventoryItem(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/items`, async (request, reply) => {
    const row = await service.createInventoryItem(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/items/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateInventoryItem(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/movements`, async (request, reply) => {
    const rows = await service.listStockMovements(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/movements/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getStockMovement(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/movements`, async (request, reply) => {
    const row = await service.createStockMovement(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/movements/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateStockMovement(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

}
