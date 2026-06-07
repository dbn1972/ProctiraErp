/**
 * Fastify Registration Plugin
 *
 * Registers public registration routes and service on a Fastify instance.
 * This plugin provides the registration portal backend for public-facing
 * student enrollment applications.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { RegistrationRepository } from './registration-repository.js';
import { RegistrationService } from './registration-service.js';
import { registerRegistrationRoutes } from './routes.js';

/**
 * Options for the registration plugin.
 */
export interface RegistrationPluginOptions {
  /** Registration repository implementation */
  repository: RegistrationRepository;
  /** Route prefix for registration endpoints (default: '/registrations') */
  prefix?: string;
  /** Default tenant ID for public routes */
  defaultTenantId?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    registrationService: RegistrationService;
  }
}

/**
 * Fastify plugin that registers the registration service and public routes.
 *
 * All routes are public (no authentication required) as they serve
 * the public registration portal for parents/students.
 */
export const registrationPlugin = fp(
  async function registrationPluginImpl(
    fastify: FastifyInstance,
    options: RegistrationPluginOptions,
  ) {
    const { repository, prefix = '/registrations', defaultTenantId } = options;

    // Create registration service instance
    const registrationService = new RegistrationService(repository);

    // Decorate fastify with the registration service
    fastify.decorate('registrationService', registrationService);

    // Register public registration routes
    await registerRegistrationRoutes(fastify, {
      registrationService,
      prefix,
      defaultTenantId,
    });
  },
  {
    name: '@proctira/backend-registration',
    fastify: '4.x',
    dependencies: [],
  },
);
