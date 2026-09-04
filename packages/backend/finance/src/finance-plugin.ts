import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { FinanceRepository } from './finance-repository.js';
import { FinanceService } from './finance-service.js';
import { registerFinanceRoutes } from './routes.js';

export interface FinancePluginOptions {
  repository: FinanceRepository;
  prefix?: string;
}

export const financePlugin = fp(
  async function financePluginImpl(
    fastify: FastifyInstance,
    options: FinancePluginOptions,
  ) {
    const service = new FinanceService(options.repository);
    await registerFinanceRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/fees',
    });
  },
  { name: '@proctira/backend-finance', fastify: '4.x' },
);
