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

import type { TransportFeesPort } from './fees-port.js';
import { registerTransportRoutes } from './routes.js';
import type { TransportRepository } from './transport-repository.js';
import { TransportService } from './transport-service.js';

/**
 * Options for the transport plugin.
 */
export interface TransportPluginOptions {
  /** Transport repository implementation */
  repository: TransportRepository;
  /** Route prefix for transport (default: '/transport') */
  prefix?: string;
  /** Optional G-903 fees port (injected by api-gateway). */
  feesService?: TransportFeesPort;
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
    const { repository, prefix = '/transport', feesService } = options;

    // Create transport service instance
    const transportService = new TransportService(repository, undefined, feesService);

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
