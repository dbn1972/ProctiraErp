import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PayrollService } from './payroll-service.js';

export interface PayrollRoutesOptions {
  service: PayrollService;
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

export async function registerPayrollRoutes(
  fastify: FastifyInstance,
  options: PayrollRoutesOptions,
) {
  const prefix = options.prefix ?? '/payroll';
  const { service } = options;

  fastify.get(`${prefix}/structures`, async (request, reply) => {
    const rows = await service.listPayStructures(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/structures/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getPayStructure(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/structures`, async (request, reply) => {
    const row = await service.createPayStructure(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/structures/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updatePayStructure(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/runs`, async (request, reply) => {
    const rows = await service.listPayrollRuns(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/runs/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getPayrollRun(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/runs`, async (request, reply) => {
    const row = await service.createPayrollRun(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/runs/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updatePayrollRun(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/payslips`, async (request, reply) => {
    const rows = await service.listPayslips(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/payslips/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getPayslip(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/payslips`, async (request, reply) => {
    const row = await service.createPayslip(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/payslips/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updatePayslip(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

}
