import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LibraryService } from './library-service.js';

export interface LibraryRoutesOptions {
  service: LibraryService;
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

export async function registerLibraryRoutes(
  fastify: FastifyInstance,
  options: LibraryRoutesOptions,
) {
  const prefix = options.prefix ?? '/library';
  const { service } = options;

  fastify.get(`${prefix}/titles`, async (request, reply) => {
    const rows = await service.listLibraryTitles(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/titles/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getLibraryTitle(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/titles`, async (request, reply) => {
    const row = await service.createLibraryTitle(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/titles/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateLibraryTitle(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/copies`, async (request, reply) => {
    const rows = await service.listLibraryCopys(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/copies/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getLibraryCopy(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/copies`, async (request, reply) => {
    const row = await service.createLibraryCopy(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/copies/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateLibraryCopy(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/loans`, async (request, reply) => {
    const rows = await service.listLibraryLoans(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/loans/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getLibraryLoan(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/loans`, async (request, reply) => {
    const row = await service.createLibraryLoan(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/loans/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateLibraryLoan(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

}
