import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CanteenService } from './canteen-service.js';

export interface CanteenRoutesOptions {
  service: CanteenService;
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

export async function registerCanteenRoutes(
  fastify: FastifyInstance,
  options: CanteenRoutesOptions,
) {
  const prefix = options.prefix ?? '/canteen';
  const { service } = options;

  fastify.get(`${prefix}/menus`, async (request, reply) => {
    const rows = await service.listMealMenus(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/menus/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getMealMenu(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/menus`, async (request, reply) => {
    const row = await service.createMealMenu(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/menus/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateMealMenu(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/servings`, async (request, reply) => {
    const rows = await service.listMealServings(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/servings/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getMealServing(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/servings`, async (request, reply) => {
    const row = await service.createMealServing(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/servings/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateMealServing(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

}
