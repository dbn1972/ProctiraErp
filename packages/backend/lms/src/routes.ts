import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LmsService } from './lms-service.js';

export interface LmsRoutesOptions {
  service: LmsService;
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

export async function registerLmsRoutes(
  fastify: FastifyInstance,
  options: LmsRoutesOptions,
) {
  const prefix = options.prefix ?? '/lms';
  const { service } = options;

  fastify.get(`${prefix}/courses`, async (request, reply) => {
    const rows = await service.listLmsCourses(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/courses/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getLmsCourse(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/courses`, async (request, reply) => {
    const row = await service.createLmsCourse(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/courses/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateLmsCourse(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/lessons`, async (request, reply) => {
    const rows = await service.listLmsLessons(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/lessons/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getLmsLesson(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/lessons`, async (request, reply) => {
    const row = await service.createLmsLesson(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/lessons/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateLmsLesson(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/enrollments`, async (request, reply) => {
    const rows = await service.listLmsEnrollments(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/enrollments/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getLmsEnrollment(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/enrollments`, async (request, reply) => {
    const row = await service.createLmsEnrollment(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/enrollments/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateLmsEnrollment(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

}
