import type { FastifyInstance, FastifyRequest } from 'fastify';
import { FinanceService } from './finance-service.js';

export interface FinanceRoutesOptions {
  service: FinanceService;
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

export async function registerFinanceRoutes(
  fastify: FastifyInstance,
  options: FinanceRoutesOptions,
) {
  const prefix = options.prefix ?? '/fees';
  const { service } = options;

  fastify.get(`${prefix}/structures`, async (request, reply) => {
    const rows = await service.listFeeStructures(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/structures/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getFeeStructure(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/structures`, async (request, reply) => {
    const row = await service.createFeeStructure(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/structures/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateFeeStructure(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/invoices`, async (request, reply) => {
    const rows = await service.listInvoices(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/invoices/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getInvoice(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/invoices`, async (request, reply) => {
    const row = await service.createInvoice(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/invoices/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateInvoice(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/payments`, async (request, reply) => {
    const rows = await service.listPayments(tenantIdOf(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/payments/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getPayment(tenantIdOf(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/payments`, async (request, reply) => {
    const row = await service.createPayment(tenantIdOf(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/payments/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updatePayment(tenantIdOf(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

}
