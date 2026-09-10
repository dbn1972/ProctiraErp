import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { AcademicVisibilityStore } from './academic-visibility.js';
import { createAcademicVisibilityStore } from './create-parent-portal-repository.js';
import type { ParentPortalRepository } from './parent-portal-repository.js';
import { ParentPortalService, type FeesLedgerPort } from './parent-portal-service.js';
import { registerParentPortalRoutes } from './routes.js';

export interface ParentPortalPluginOptions {
  repository: ParentPortalRepository;
  academicStore?: AcademicVisibilityStore;
  prefix?: string;
  studentPrefix?: string;
  feesService?: FeesLedgerPort;
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
    const {
      repository,
      academicStore,
      prefix = '/parent-portal',
      studentPrefix = '/student-portal',
      feesService,
    } = options;
    const parentPortalService = new ParentPortalService(
      repository,
      academicStore ?? createAcademicVisibilityStore(),
      feesService,
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
