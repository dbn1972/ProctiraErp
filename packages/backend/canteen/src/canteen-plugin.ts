import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { CanteenRepository } from './canteen-repository.js';
import { CanteenService } from './canteen-service.js';
import { registerCanteenRoutes } from './routes.js';

export interface CanteenPluginOptions {
  repository: CanteenRepository;
  prefix?: string;
}

export const canteenPlugin = fp(
  async function canteenPluginImpl(
    fastify: FastifyInstance,
    options: CanteenPluginOptions,
  ) {
    const service = new CanteenService(options.repository);
    await registerCanteenRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/canteen',
    });
  },
  { name: '@proctira/backend-canteen', fastify: '4.x' },
);
