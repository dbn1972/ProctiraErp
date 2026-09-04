import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { LmsRepository } from './lms-repository.js';
import { LmsService } from './lms-service.js';
import { registerLmsRoutes } from './routes.js';

export interface LmsPluginOptions {
  repository: LmsRepository;
  prefix?: string;
}

export const lmsPlugin = fp(
  async function lmsPluginImpl(
    fastify: FastifyInstance,
    options: LmsPluginOptions,
  ) {
    const service = new LmsService(options.repository);
    await registerLmsRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/lms',
    });
  },
  { name: '@proctira/backend-lms', fastify: '4.x' },
);
