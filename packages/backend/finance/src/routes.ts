import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isFinanceDomainError } from './finance-errors.js';
import { FinanceService } from './finance-service.js';

export interface FinanceRoutesOptions {
  service: FinanceService;
  prefix?: string;
}

function tenantIdOf(request: FastifyRequest): string | null {
  const user = request.user as { tenantId?: string } | undefined;
  return (
    user?.tenantId ??
    (request.headers['x-tenant-id'] as string | undefined) ??
    null
  );
}

function requireTenant(request: FastifyRequest): string {
  const tenantId = tenantIdOf(request);
  if (!tenantId) {
    const err = new Error('TENANT_REQUIRED');
    (err as Error & { statusCode: number }).statusCode = 401;
    throw err;
  }
  return tenantId;
}

export async function registerFinanceRoutes(
  fastify: FastifyInstance,
  options: FinanceRoutesOptions,
) {
  const prefix = options.prefix ?? '/fees';
  const { service } = options;

  fastify.setErrorHandler((error, _request, reply) => {
    if (isFinanceDomainError(error)) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if ((error as { message?: string }).message === 'TENANT_REQUIRED') {
      return reply.status(401).send({ error: 'unauthorized', message: 'Tenant required' });
    }
    throw error;
  });

  fastify.get(`${prefix}/structures`, async (request, reply) => {
    const rows = await service.listFeeStructures(requireTenant(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/structures/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getFeeStructure(requireTenant(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/structures`, async (request, reply) => {
    const row = await service.createFeeStructure(
      requireTenant(request),
      request.body as any,
    );
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/structures/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateFeeStructure(
      requireTenant(request),
      id,
      request.body as any,
    );
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/assignments`, async (request, reply) => {
    const rows = await service.listFeeAssignments(requireTenant(request));
    return reply.send({ data: rows });
  });
  fastify.post(`${prefix}/assignments`, async (request, reply) => {
    const row = await service.assignFee(requireTenant(request), request.body as any);
    return reply.status(201).send(row);
  });

  fastify.post(`${prefix}/invoices/generate`, async (request, reply) => {
    const body = request.body as { feeStructureId: string; dueDate: string };
    const result = await service.generateInvoices(requireTenant(request), body);
    return reply.status(201).send(result);
  });

  fastify.get(`${prefix}/invoices`, async (request, reply) => {
    const rows = await service.listInvoices(requireTenant(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/invoices/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getInvoice(requireTenant(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/invoices`, async (request, reply) => {
    const row = await service.createInvoice(requireTenant(request), request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/invoices/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updateInvoice(requireTenant(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/payments`, async (request, reply) => {
    const rows = await service.listPayments(requireTenant(request));
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/payments/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getPayment(requireTenant(request), id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/payments`, async (request, reply) => {
    const result = await service.recordPayment(requireTenant(request), request.body as any);
    return reply.status(201).send(result);
  });
  fastify.put(`${prefix}/payments/:id`, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.updatePayment(requireTenant(request), id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
}
