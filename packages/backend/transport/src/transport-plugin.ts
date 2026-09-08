/**
 * Fastify Transport Plugin
 *
 * Registers transport routes and service on a Fastify instance.
 * Provides the transport service as a decorator for other plugins to use.
 *
 * Requirements: 1.2 (Transport_Module)
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { TransportRepository } from './transport-repository.js';
import { TransportService } from './transport-service.js';
import { registerTransportRoutes } from './routes.js';

/**
 * Options for the transport plugin.
 */
export interface TransportPluginOptions {
  /** Transport repository implementation */
  repository: TransportRepository;
  /** Route prefix for transport (default: '/transport') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    transportService: TransportService;
  }
}

/**
 * Fastify plugin that registers the transport service and routes.
 */
export const transportPlugin = fp(
  async function transportPluginImpl(fastify: FastifyInstance, options: TransportPluginOptions) {
    const { repository, prefix = '/transport' } = options;

    // Create transport service instance
    const transportService = new TransportService(repository);

    // Decorate fastify with the transport service
    fastify.decorate('transportService', transportService);

    // Register transport routes
    await registerTransportRoutes(fastify, {
      transportService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-transport',
    fastify: '5.x',
    dependencies: [],
  },
);
