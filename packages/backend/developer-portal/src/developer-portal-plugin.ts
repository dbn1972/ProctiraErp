/**
 * Developer Portal Fastify Plugin
 *
 * Registers developer portal service routes and decorators on a Fastify instance.
 * Provides the developer portal service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { DeveloperPortalExtendedRepository } from './developer-portal-repository.js';
import {
  DeveloperPortalService,
  type DeveloperPortalServiceConfig,
  DEFAULT_CONFIG,
} from './developer-portal-service.js';
import { registerDeveloperPortalRoutes } from './routes.js';

/**
 * Options for the developer portal plugin.
 */
export interface DeveloperPortalPluginOptions {
  /** Developer portal repository implementation */
  repository: DeveloperPortalExtendedRepository;
  /** Service configuration (optional, uses defaults) */
  config?: Partial<DeveloperPortalServiceConfig>;
  /** Durable webhook delivery publisher (W2-JOB-07) */
  deliveryPublisher?: import('./queue-webhook-delivery-publisher.js').WebhookDeliveryPublisher;
  /** Route prefix (default: '/developer') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    developerPortalService: DeveloperPortalService;
  }
}

/**
 * Fastify plugin that registers the developer portal service and routes.
 */
export const developerPortalPlugin = fp(
  async function developerPortalPluginImpl(
    fastify: FastifyInstance,
    options: DeveloperPortalPluginOptions,
  ) {
    const { repository, config = {}, deliveryPublisher, prefix = '/developer' } = options;

    // Merge config with defaults
    const fullConfig: DeveloperPortalServiceConfig = { ...DEFAULT_CONFIG, ...config };

    // Create service instance
    const service = new DeveloperPortalService(repository, fullConfig, { deliveryPublisher });

    // Decorate fastify with the service
    fastify.decorate('developerPortalService', service);

    // Register routes
    await registerDeveloperPortalRoutes(fastify, { service, prefix });
  },
  {
    name: '@proctira/backend-developer-portal',
    fastify: '5.x',
    dependencies: [],
  },
);
