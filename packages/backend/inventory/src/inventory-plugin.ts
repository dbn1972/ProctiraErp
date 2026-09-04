import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { InventoryRepository } from './inventory-repository.js';
import { InventoryService } from './inventory-service.js';
import { registerInventoryRoutes } from './routes.js';

export interface InventoryPluginOptions {
  repository: InventoryRepository;
  prefix?: string;
}

export const inventoryPlugin = fp(
  async function inventoryPluginImpl(
    fastify: FastifyInstance,
    options: InventoryPluginOptions,
  ) {
    const service = new InventoryService(options.repository);
    await registerInventoryRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/inventory',
    });
  },
  { name: '@proctira/backend-inventory', fastify: '4.x' },
);
