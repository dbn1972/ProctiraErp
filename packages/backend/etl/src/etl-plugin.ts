/**
 * Fastify ETL Plugin
 *
 * Registers ETL service routes and decorators on a Fastify instance.
 * Provides the ETL service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { PipelineRepository } from './pipeline-repository.js';
import { ETLService, type ETLServiceConfig } from './etl-service.js';
import { registerETLRoutes } from './routes.js';

/**
 * Options for the ETL plugin.
 */
export interface ETLPluginOptions {
  /** Pipeline repository implementation */
  repository: PipelineRepository;
  /** ETL service configuration */
  config: ETLServiceConfig;
  /** Route prefix (default: '/pipelines') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    etlService: ETLService;
  }
}

/**
 * Fastify plugin that registers the ETL service and routes.
 */
export const etlPlugin = fp(
  async function etlPluginImpl(fastify: FastifyInstance, options: ETLPluginOptions) {
    const { repository, config, prefix = '/pipelines' } = options;

    // Create ETL service instance
    const etlService = new ETLService(repository, config);

    // Decorate fastify with the ETL service
    fastify.decorate('etlService', etlService);

    // Register ETL routes
    await registerETLRoutes(fastify, {
      etlService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-etl',
    fastify: '4.x',
    dependencies: [],
  },
);
