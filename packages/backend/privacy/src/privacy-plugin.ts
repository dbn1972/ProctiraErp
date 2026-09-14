/**
 * Fastify Privacy Plugin — legal hold + erasure lifecycle (W1-SEC-06 / W1-ARCH-05).
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { PrivacyRepository } from './privacy-repository.js';
import { PrivacyService } from './privacy-service.js';
import { registerPrivacyRoutes } from './routes.js';

export interface PrivacyPluginOptions {
  repository: PrivacyRepository;
  /** Route prefix (default: `/privacy`). */
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    privacyService: PrivacyService;
  }
}

export const privacyPlugin = fp(
  async function privacyPluginImpl(fastify: FastifyInstance, options: PrivacyPluginOptions) {
    const { repository, prefix = '/privacy' } = options;
    const privacyService = new PrivacyService(repository);
    fastify.decorate('privacyService', privacyService);
    await registerPrivacyRoutes(fastify, { privacyService, prefix });
  },
  { name: '@proctira/backend-privacy', fastify: '5.x', dependencies: [] },
);
