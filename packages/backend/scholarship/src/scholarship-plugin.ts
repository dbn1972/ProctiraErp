/**
 * Fastify Scholarship Plugin
 *
 * Registers scholarship routes and service on a Fastify instance.
 * Provides the scholarship service as a decorator for other plugins to use.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { ScholarshipRepository } from './scholarship-repository.js';
import { ScholarshipService } from './scholarship-service.js';
import type { WorkflowEngineClient, ScholarshipServiceOptions } from './scholarship-service.js';
import { registerScholarshipRoutes } from './routes.js';

/**
 * Options for the scholarship plugin.
 */
export interface ScholarshipPluginOptions {
  /** Scholarship repository implementation */
  repository: ScholarshipRepository;
  /** Workflow engine client for approval routing (optional) */
  workflowEngine?: WorkflowEngineClient;
  /** Service configuration options */
  serviceOptions?: ScholarshipServiceOptions;
  /** Route prefix for scholarships (default: '/scholarships') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    scholarshipService: ScholarshipService;
  }
}

/**
 * Fastify plugin that registers the scholarship service and routes.
 */
export const scholarshipPlugin = fp(
  async function scholarshipPluginImpl(
    fastify: FastifyInstance,
    options: ScholarshipPluginOptions,
  ) {
    const { repository, workflowEngine, serviceOptions, prefix = '/scholarships' } = options;

    // Create scholarship service instance
    const scholarshipService = new ScholarshipService(repository, workflowEngine, serviceOptions);

    // Decorate fastify with the scholarship service
    fastify.decorate('scholarshipService', scholarshipService);

    // Register scholarship routes
    await registerScholarshipRoutes(fastify, {
      scholarshipService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-scholarship',
    fastify: '4.x',
    dependencies: [],
  },
);
