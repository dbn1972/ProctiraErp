import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import {
  EmptyAcademicVisibilityStore,
  type AcademicVisibilityStore,
} from './academic-visibility.js';
import type { ParentPortalRepository } from './parent-portal-repository.js';
import { ParentPortalService } from './parent-portal-service.js';
import { registerParentPortalRoutes } from './routes.js';

export interface ParentPortalPluginOptions {
  repository: ParentPortalRepository;
  academicStore?: AcademicVisibilityStore;
  prefix?: string;
  studentPrefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    parentPortalService: ParentPortalService;
  }
}

export const parentPortalPlugin = fp(
  async function parentPortalPluginImpl(
    fastify: FastifyInstance,
    options: ParentPortalPluginOptions,
  ) {
    const { repository, academicStore, prefix = '/parent-portal', studentPrefix = '/student-portal' } =
      options;
    const parentPortalService = new ParentPortalService(
      repository,
      academicStore ?? new EmptyAcademicVisibilityStore(),
    );
    fastify.decorate('parentPortalService', parentPortalService);
    await registerParentPortalRoutes(fastify, { parentPortalService, prefix, studentPrefix });
  },
  {
    name: '@proctira/backend-parent-portal',
    fastify: '5.x',
    dependencies: [],
  },
);
