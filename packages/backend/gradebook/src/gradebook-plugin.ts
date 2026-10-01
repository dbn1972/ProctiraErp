import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { createGradebookExtrasStore } from './extras-factory.js';
import type { GradebookExtrasStore } from './extras-store.js';
import type { GradebookRepository } from './gradebook-repository.js';
import { GradebookService } from './gradebook-service.js';
import { registerGradebookRoutes } from './routes.js';
import { prepareTranscriptSigningAtStartup } from './signed-download.js';

/**
 * PRC-C006: resolves the student ids a portal caller (parent/guardian/student) may read.
 * Returns the caller's own student id (student) or linked wards (guardian/parent). When absent,
 * portal callers are denied on self-scopable read routes (fail closed).
 */
export interface GradebookStudentBinding {
  listReadableStudentIds(tenantId: string, actorUserId: string): Promise<string[]>;
}

export interface GradebookPluginOptions {
  repository: GradebookRepository;
  extras?: GradebookExtrasStore;
  prefix?: string;
  /** PRC-C006: portal self-scope binding. */
  studentBinding?: GradebookStudentBinding;
}

declare module 'fastify' {
  interface FastifyInstance {
    gradebookService: GradebookService;
  }
}

export const gradebookPlugin = fp(
  async function gradebookPluginImpl(fastify: FastifyInstance, options: GradebookPluginOptions) {
    prepareTranscriptSigningAtStartup(process.env, {
      warn: (obj, msg) => {
        fastify.log.warn(obj, msg);
      },
      error: (obj, msg) => {
        fastify.log.error(obj, msg);
      },
    });
    const extras = options.extras ?? createGradebookExtrasStore();
    const service = new GradebookService(options.repository, extras);
    fastify.decorate('gradebookService', service);
    await registerGradebookRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/gradebook',
      studentBinding: options.studentBinding,
    });
  },
  {
    name: '@proctira/backend-gradebook',
    fastify: '5.x',
    dependencies: [],
  },
);
