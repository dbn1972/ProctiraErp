/**
 * Fastify Policy Plugin
 *
 * Registers policy routes and service on a Fastify instance.
 * Provides the policy service as a decorator for other plugins to use.
 *
 * Charter: Section 27 (Security and Compliance)
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { PolicyRepository } from './policy-repository.js';
import { PolicyService } from './policy-service.js';
import { registerPolicyRoutes } from './routes.js';

/**
 * Options for the policy plugin.
 */
export interface PolicyPluginOptions {
  /** Policy repository implementation */
  repository: PolicyRepository;
  /** Route prefix for policies (default: '/policies') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    policyService: PolicyService;
  }
}

/**
 * Fastify plugin that registers the policy service and routes.
 */
export const policyPlugin = fp(
  async function policyPluginImpl(fastify: FastifyInstance, options: PolicyPluginOptions) {
    const { repository, prefix = '/policies' } = options;

    // Create policy service instance
    const policyService = new PolicyService(repository);

    // Decorate fastify with the policy service
    fastify.decorate('policyService', policyService);

    // Register policy routes
    await registerPolicyRoutes(fastify, {
      policyService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-policy',
    fastify: '4.x',
    dependencies: [],
  },
);
