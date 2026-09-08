/**
 * Fastify Health Plugin
 *
 * Registers health routes and service on a Fastify instance.
 * Provides the health service as a decorator for other plugins to use.
 *
 * Requirements:
 * - 12.1: Health data CRUD (measurements, allergies, conditions, vaccinations, insurance)
 * - 12.2: Special needs assessments, diagnoses, referrals, accommodation plans
 * - 12.3: Counselling session management with case notes and follow-ups
 * - 12.4: Restrict access to authorized health personnel and student's guardian
 * - 12.5: Configurable health screening programs per grade level
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { HealthRepository } from './health-repository.js';
import { HealthService } from './health-service.js';
import { registerHealthRoutes } from './routes.js';

/**
 * Options for the health plugin.
 */
export interface HealthPluginOptions {
  /** Health repository implementation */
  repository: HealthRepository;
  /** Route prefix for health endpoints (default: '/health') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    healthService: HealthService;
  }
}

/**
 * Fastify plugin that registers the health service and routes.
 */
export const healthPlugin = fp(
  async function healthPluginImpl(fastify: FastifyInstance, options: HealthPluginOptions) {
    const { repository, prefix = '/health' } = options;

    // Create health service instance
    const healthService = new HealthService(repository);

    // Decorate fastify with the health service
    fastify.decorate('healthService', healthService);

    // Register health routes
    await registerHealthRoutes(fastify, {
      healthService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-health',
    fastify: '5.x',
    dependencies: [],
  },
);
