import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { ParentPortalRepository } from './parent-portal-repository.js';
import { ParentPortalService, type FeesLedgerPort } from './parent-portal-service.js';
import { registerParentPortalRoutes } from './routes.js';

export interface ParentPortalPluginOptions {
  repository: ParentPortalRepository;
  prefix?: string;
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
    const { repository, prefix = '/parent-portal', feesService } = options;
    const parentPortalService = new ParentPortalService(repository, feesService);
    fastify.decorate('parentPortalService', parentPortalService);
    await registerParentPortalRoutes(fastify, { parentPortalService, prefix });
  },
  {
    name: '@proctira/backend-parent-portal',
    fastify: '5.x',
    dependencies: [],
  },
);
