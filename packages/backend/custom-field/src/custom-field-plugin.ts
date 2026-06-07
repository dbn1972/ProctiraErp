/**
 * Fastify Custom Field Plugin
 *
 * Registers custom field routes and service on a Fastify instance.
 * Provides the custom field service as a decorator for other plugins to use.
 *
 * Requirements:
 * - 6.5: Support Custom_Fields to extend student profiles without database schema changes
 * - 7.6: Support Custom_Fields to extend staff profiles without database schema changes
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { CustomFieldDefinitionRepository, CustomFieldValueRepository } from './custom-field-repository.js';
import { CustomFieldService } from './custom-field-service.js';
import { registerCustomFieldRoutes } from './routes.js';

/**
 * Options for the custom field plugin.
 */
export interface CustomFieldPluginOptions {
  /** Custom field definition repository implementation */
  definitionRepository: CustomFieldDefinitionRepository;
  /** Custom field value repository implementation */
  valueRepository: CustomFieldValueRepository;
  /** Route prefix for custom fields (default: '/custom-fields') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    customFieldService: CustomFieldService;
  }
}

/**
 * Fastify plugin that registers the custom field service and routes.
 */
export const customFieldPlugin = fp(
  async function customFieldPluginImpl(
    fastify: FastifyInstance,
    options: CustomFieldPluginOptions,
  ) {
    const { definitionRepository, valueRepository, prefix = '/custom-fields' } = options;

    // Create custom field service instance
    const customFieldService = new CustomFieldService(definitionRepository, valueRepository);

    // Decorate fastify with the custom field service
    fastify.decorate('customFieldService', customFieldService);

    // Register custom field routes
    await registerCustomFieldRoutes(fastify, {
      customFieldService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-custom-field',
    fastify: '4.x',
    dependencies: [],
  },
);
