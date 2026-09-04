import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { PayrollRepository } from './payroll-repository.js';
import { PayrollService } from './payroll-service.js';
import { registerPayrollRoutes } from './routes.js';

export interface PayrollPluginOptions {
  repository: PayrollRepository;
  prefix?: string;
}

export const payrollPlugin = fp(
  async function payrollPluginImpl(
    fastify: FastifyInstance,
    options: PayrollPluginOptions,
  ) {
    const service = new PayrollService(options.repository);
    await registerPayrollRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/payroll',
    });
  },
  { name: '@proctira/backend-payroll', fastify: '4.x' },
);
