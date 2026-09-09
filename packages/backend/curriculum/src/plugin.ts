import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerCurriculumRoutes } from './routes.js';
import { CurriculumService } from './service.js';
import type { CurriculumStore } from './store.js';

export interface CurriculumPluginOptions {
  store: CurriculumStore;
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    curriculumService: CurriculumService;
  }
}

export const curriculumPlugin = fp(
  async function curriculumPluginImpl(fastify: FastifyInstance, options: CurriculumPluginOptions) {
    const service = new CurriculumService(options.store);
    fastify.decorate('curriculumService', service);
    await registerCurriculumRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/curriculum',
    });
  },
  {
    name: '@proctira/backend-curriculum',
    fastify: '5.x',
    dependencies: [],
  },
);
