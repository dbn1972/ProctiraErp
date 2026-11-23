/**
 * Fastify Plugin Plugin
 *
 * Registers plugin service routes and decorators on a Fastify instance.
 * Provides the plugin service as a decorator for other plugins to use.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { PluginAuditPort } from './audit-port.js';
import type { ExtensionPointRegistry } from './extension-points/extension-point-registry.js';
import type { PluginRepository } from './plugin-repository.js';
import { PluginService, type PluginServiceConfig } from './plugin-service.js';
import { registerPluginRoutes } from './routes.js';

/**
 * Options for the plugin plugin.
 */
export interface PluginPluginOptions {
  /** Plugin repository implementation */
  repository: PluginRepository;
  /** Plugin service configuration */
  config: PluginServiceConfig;
  /** Route prefix (default: '/plugins') */
  prefix?: string;
  /**
   * PRC-M604: extension-point registry kept in sync with the install lifecycle
   * (disable/uninstall unregister the install's hooks, UI slots and events).
   */
  registry?: ExtensionPointRegistry;
  /**
   * PRC-L477: durable, tenant-aware audit sink (e.g. the platform audit store).
   * When omitted, audit rows go to the repository's plugin-local audit log.
   */
  auditPort?: PluginAuditPort;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    pluginService: PluginService;
  }
}

/**
 * Fastify plugin that registers the plugin service and routes.
 */
export const pluginPlugin = fp(
  async function pluginPluginImpl(fastify: FastifyInstance, options: PluginPluginOptions) {
    const { repository, config, prefix = '/plugins', registry, auditPort } = options;

    // Create plugin service instance
    const pluginService = new PluginService(repository, config, registry, auditPort);

    // Decorate fastify with the plugin service
    fastify.decorate('pluginService', pluginService);

    // Register plugin routes
    await registerPluginRoutes(fastify, {
      pluginService,
      prefix,
    });
  },
  {
    name: '@proctira/backend-plugin',
    fastify: '5.x',
    dependencies: [],
  },
);
