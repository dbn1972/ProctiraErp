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
  /**
   * PRC-M185: interval for the subscription lifecycle sweep (trial expiry + period roll).
   * Default 15 minutes; 0 disables (reads still refresh lazily).
   */
  lifecycleSweepIntervalMs?: number;
}

const DEFAULT_LIFECYCLE_SWEEP_MS = 15 * 60 * 1000;

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

    // PRC-M185: persist trial expiry / period roll-over even for tenants that are not reading.
    const sweepMs = options.lifecycleSweepIntervalMs ?? DEFAULT_LIFECYCLE_SWEEP_MS;
    if (sweepMs > 0) {
      let running = false;
      const timer = setInterval(() => {
        if (running) return;
        running = true;
        billingService
          .runLifecycleSweep()
          .then((result) => {
            if (result.expiredTrials || result.rolledPeriods || result.failures) {
              fastify.log.info(result, 'billing lifecycle sweep');
            }
          })
          .catch((error: unknown) =>
            fastify.log.error({ err: error }, 'billing lifecycle sweep failed'),
          )
          .finally(() => {
            running = false;
          });
      }, sweepMs);
      timer.unref();
      fastify.addHook('onClose', async () => clearInterval(timer));
    }

    // Encapsulate routes + plugin-wide preHandler so `fp` does not leak
    // billing RBAC onto every gateway route (W1-SEC-02).
    await fastify.register(async (scope) => {
      await registerBillingRoutes(scope, {
        billingService,
        prefix,
      });
    });
  },
  {
    name: '@proctira/backend-billing',
    fastify: '5.x',
    dependencies: [],
  },
);
