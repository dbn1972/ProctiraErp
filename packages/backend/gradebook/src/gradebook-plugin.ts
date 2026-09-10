import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createGradebookExtrasStore } from './extras-factory.js';
import type { GradebookExtrasStore } from './extras-store.js';
import type { GradebookRepository } from './gradebook-repository.js';
import { GradebookService } from './gradebook-service.js';
import { registerGradebookRoutes } from './routes.js';

export interface GradebookPluginOptions {
  repository: GradebookRepository;
  extras?: GradebookExtrasStore;
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    gradebookService: GradebookService;
  }
}

export const gradebookPlugin = fp(
  async function gradebookPluginImpl(fastify: FastifyInstance, options: GradebookPluginOptions) {
    const extras = options.extras ?? createGradebookExtrasStore();
    const service = new GradebookService(options.repository, extras);
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
