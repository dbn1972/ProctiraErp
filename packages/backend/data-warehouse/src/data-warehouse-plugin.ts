/**
 * Fastify Data Warehouse Plugin
 *
 * Registers Data Warehouse service routes and decorators on a Fastify instance.
 * Provides the Data Warehouse service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { WarehouseRepository } from './warehouse-repository.js';
import { DataWarehouseService, type DataWarehouseServiceConfig } from './data-warehouse-service.js';
import { registerDataWarehouseRoutes } from './routes.js';

/**
 * Options for the Data Warehouse plugin.
 */
export interface DataWarehousePluginOptions {
  /** Warehouse repository implementation */
  repository: WarehouseRepository;
  /** Data Warehouse service configuration */
  config: DataWarehouseServiceConfig;
  /** Route prefix (default: '/warehouses') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    dataWarehouseService: DataWarehouseService;
  }
}

/**
 * Fastify plugin that registers the Data Warehouse service and routes.
 */
export const dataWarehousePlugin = fp(
  async function dataWarehousePluginImpl(
    fastify: FastifyInstance,
    options: DataWarehousePluginOptions,
  ) {
    const { repository, config, prefix = '/warehouses' } = options;

    // Create Data Warehouse service instance
    const dataWarehouseService = new DataWarehouseService(repository, config);

    // Decorate fastify with the Data Warehouse service
    fastify.decorate('dataWarehouseService', dataWarehouseService);

    // Register Data Warehouse routes
    await registerDataWarehouseRoutes(fastify, {
      dataWarehouseService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-data-warehouse',
    fastify: '4.x',
    dependencies: [],
  },
);
