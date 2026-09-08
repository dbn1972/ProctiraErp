import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { GradebookRepository } from './gradebook-repository.js';
import { GradebookService } from './gradebook-service.js';
import { registerGradebookRoutes } from './routes.js';

export interface GradebookPluginOptions {
  repository: GradebookRepository;
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    gradebookService: GradebookService;
  }
}

export const gradebookPlugin = fp(
  async function gradebookPluginImpl(fastify: FastifyInstance, options: GradebookPluginOptions) {
    const service = new GradebookService(options.repository);
    fastify.decorate('gradebookService', service);
    await registerGradebookRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/gradebook',
    });
  },
  {
    name: '@proctira/backend-gradebook',
    fastify: '5.x',
    dependencies: [],
  },
);
