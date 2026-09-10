/**
 * Fastify Theme Plugin
 *
 * Registers theme service routes and decorators on a Fastify instance.
 * Provides the theme service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { ThemeRepository } from './theme-repository.js';
import { ThemeService, type ThemeServiceConfig } from './theme-service.js';
import { registerThemeRoutes } from './routes.js';

/**
 * Options for the theme plugin.
 */
export interface ThemePluginOptions {
  /** Theme repository implementation */
  repository: ThemeRepository;
  /** Theme service configuration */
  config?: ThemeServiceConfig;
  /** Route prefix (default: '/themes') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    themeService: ThemeService;
  }
}

/**
 * Fastify plugin that registers the theme service and routes.
 */
export const themePlugin = fp(
  async function themePluginImpl(fastify: FastifyInstance, options: ThemePluginOptions) {
    const { repository, config = {}, prefix = '/themes' } = options;

    // Create theme service instance
    const themeService = new ThemeService(repository, config);

    // Decorate fastify with the theme service
    fastify.decorate('themeService', themeService);

    // Register theme routes
    await registerThemeRoutes(fastify, {
      themeService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-theme',
    fastify: '5.x',
    dependencies: [],
  },
);
