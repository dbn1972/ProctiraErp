import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@proctira/common';
import { PayrollService } from './payroll-service.js';

export interface PayrollRoutesOptions {
  service: PayrollService;
  prefix?: string;
}

function tenantIdOf(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  const tenantId =
    user?.tenantId ?? (request.headers['x-tenant-id'] as string | undefined);
  if (!tenantId) {
    reply.status(401).send({
      error: 'unauthorized',
      message: 'Tenant context required (user.tenantId or x-tenant-id)',
    });
    return undefined;
  }
  return tenantId;
}

export async function registerPayrollRoutes(
  fastify: FastifyInstance,
  options: PayrollRoutesOptions,
) {
  const prefix = options.prefix ?? '/payroll';
  const { service } = options;

  fastify.get(`${prefix}/structures`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const rows = await service.listPayStructures(tenantId);
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/structures/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.getPayStructure(tenantId, id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/structures`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const row = await service.createPayStructure(tenantId, request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/structures/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.updatePayStructure(tenantId, id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/runs`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const rows = await service.listPayrollRuns(tenantId);
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/runs/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.getPayrollRun(tenantId, id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  /** Generate a payroll run + payslips from a pay structure (must be before :id). */
  fastify.post(`${prefix}/runs/generate`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const body = request.body as {
        periodYear: number;
        periodMonth: number;
        payStructureId: string;
        staffIds: string[];
      };
      const result = await service.generateRun(tenantId, body);
      return reply.status(201).send(result);
    } catch (error) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send(error.toJSON());
      }
      throw error;
    }
  });
  fastify.post(`${prefix}/runs`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const row = await service.createPayrollRun(tenantId, request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/runs/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.updatePayrollRun(tenantId, id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });

  fastify.get(`${prefix}/payslips`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const rows = await service.listPayslips(tenantId);
    return reply.send({ data: rows });
  });
  fastify.get(`${prefix}/payslips/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.getPayslip(tenantId, id);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
  fastify.post(`${prefix}/payslips`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const row = await service.createPayslip(tenantId, request.body as any);
    return reply.status(201).send(row);
  });
  fastify.put(`${prefix}/payslips/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await service.updatePayslip(tenantId, id, request.body as any);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    return reply.send(row);
  });
}
