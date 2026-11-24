import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { CurriculumTeachingScope } from './curriculum-access.js';
import { registerCurriculumRoutes } from './routes.js';
import { CurriculumService } from './service.js';
import type { CurriculumStore } from './store.js';

export interface CurriculumPluginOptions {
  store: CurriculumStore;
  prefix?: string;
  /**
   * PRC-M194: teacher -> subject ownership lookup. Teacher-only roles write only for
   * subjects they teach. Omitted: production-like envs fail closed (503) on teacher writes.
   */
  teachingScope?: CurriculumTeachingScope | null;
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
      teachingScope: options.teachingScope ?? null,
    });
  },
  {
    name: '@proctira/backend-curriculum',
    fastify: '5.x',
    dependencies: [],
  },
);
