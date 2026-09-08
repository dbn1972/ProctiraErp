/**
 * Fastify Billing Plugin
 *
 * Registers billing routes and service on a Fastify instance.
 * Provides the billing service as a decorator for other plugins to use.
 *
 * Charter: Section 10 (Subscription, Entitlements, Feature Control)
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { BillingRepository } from './billing-repository.js';
import { BillingService } from './billing-service.js';
import { registerBillingRoutes } from './routes.js';

/**
 * Options for the billing plugin.
 */
export interface BillingPluginOptions {
  /** Billing repository implementation */
  repository: BillingRepository;
  /** Route prefix for billing (default: '/billing') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    billingService: BillingService;
  }
}

/**
 * Fastify plugin that registers the billing service and routes.
 */
export const billingPlugin = fp(
  async function billingPluginImpl(fastify: FastifyInstance, options: BillingPluginOptions) {
    const { repository, prefix = '/billing' } = options;

    // Create billing service instance
    const billingService = new BillingService(repository);

    // Decorate fastify with the billing service
    fastify.decorate('billingService', billingService);

    // Register billing routes
    await registerBillingRoutes(fastify, {
      billingService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-billing',
    fastify: '4.x',
    dependencies: [],
  },
);
