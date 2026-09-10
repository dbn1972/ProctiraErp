/**
 * Fastify plugin for the LMS domain (assignments · homework · quizzes · Spiral PAL).
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { LmsRepository } from './lms-repository.js';
import { LmsService } from './lms-service.js';
import { registerLmsRoutes } from './routes.js';

export interface LmsPluginOptions {
  repository: LmsRepository;
  /** Route prefix (default: '/lms') */
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    lmsService: LmsService;
  }
}

export const lmsPlugin = fp(
  async function lmsPluginImpl(fastify: FastifyInstance, options: LmsPluginOptions) {
    const { repository, prefix = '/lms' } = options;
    const lmsService = new LmsService(repository);
    fastify.decorate('lmsService', lmsService);
    await registerLmsRoutes(fastify, { lmsService, prefix });
  },
  {
    name: '@proctira/backend-lms',
    fastify: '5.x',
    dependencies: [],
  },
);

export default lmsPlugin;
