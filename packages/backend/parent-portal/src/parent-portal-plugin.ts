import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { ParentPortalRepository } from './parent-portal-repository.js';
import { ParentPortalService } from './parent-portal-service.js';
import { registerParentPortalRoutes } from './routes.js';

export interface ParentPortalPluginOptions {
  repository: ParentPortalRepository;
  prefix?: string;
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
    const { repository, prefix = '/parent-portal' } = options;
    const parentPortalService = new ParentPortalService(repository);
    fastify.decorate('parentPortalService', parentPortalService);
    await registerParentPortalRoutes(fastify, { parentPortalService, prefix });
  },
  {
    name: '@proctira/backend-parent-portal',
    fastify: '5.x',
    dependencies: [],
  },
);
