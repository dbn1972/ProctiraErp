/**
 * Install Plugin - Fastify plugin for the Install/Bootstrap Service.
 *
 * Registers routes for:
 * - GET /install/status - Bootstrap status
 * - POST /install/configure/cdn - Configure CDN adapter
 * - POST /install/configure/database - Configure Database adapter
 * - POST /install/configure/storage - Configure Storage adapter
 * - POST /install/configure/cache - Configure Cache adapter
 * - POST /install/configure/queue - Configure Queue adapter
 * - POST /install/finalize - Finalize bootstrap
 * - GET /install/health - Aggregated health check
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { createLogger } from '@proctira/logging';
import { InstallServiceImpl } from './install-service';
import type { ConnectivityTester } from './install-service';
import { InMemoryBootstrapStore } from './bootstrap-store';
import type { BootstrapStore } from './bootstrap-store';
import type {
  CdnConfigInput,
  DatabaseConfigInput,
  StorageConfigInput,
  CacheConfigInput,
  QueueConfigInput,
} from './types';
import {
  CdnConfigSchema,
  DatabaseConfigSchema,
  StorageConfigSchema,
  CacheConfigSchema,
  QueueConfigSchema,
} from './types';

/**
 * Options for the install plugin.
 */
export interface InstallPluginOptions {
  /** Route prefix (default: '/install') */
  prefix?: string;
  /** Custom bootstrap store (default: InMemoryBootstrapStore) */
  store?: BootstrapStore;
  /** Custom connectivity tester for adapter validation */
  connectivityTester?: ConnectivityTester;
  /** Logger name override */
  loggerName?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    installService: InstallServiceImpl;
  }
}

/**
 * Fastify plugin that registers the Install/Bootstrap Service routes.
 */
export const installPlugin = fp(
  async function installPluginImpl(
    fastify: FastifyInstance,
    options: InstallPluginOptions,
  ) {
    const {
      prefix = '/install',
      store = new InMemoryBootstrapStore(),
      connectivityTester,
      loggerName = 'install-service',
    } = options;

    const logger = createLogger({ name: loggerName });

    const installService = new InstallServiceImpl({
      logger,
      store,
      connectivityTester,
    });

    // Decorate fastify instance with the service
    fastify.decorate('installService', installService);

    // Register routes under the prefix
    fastify.register(
      async function installRoutes(app) {
        // GET /install/status - Get bootstrap status
        app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
          const status = await installService.getBootstrapStatus();
          return reply.status(200).send(status);
        });

        // POST /install/configure/cdn - Configure CDN
        app.post<{ Body: CdnConfigInput }>(
          '/configure/cdn',
          {
            schema: {
              body: CdnConfigSchema,
            },
          },
          async (request, reply) => {
            const result = await installService.configureCDN(request.body);
            const statusCode = result.success ? 200 : 400;
            return reply.status(statusCode).send(result);
          },
        );

        // POST /install/configure/database - Configure Database
        app.post<{ Body: DatabaseConfigInput }>(
          '/configure/database',
          {
            schema: {
              body: DatabaseConfigSchema,
            },
          },
          async (request, reply) => {
            const result = await installService.configureDatabase(request.body);
            const statusCode = result.success ? 200 : 400;
            return reply.status(statusCode).send(result);
          },
        );

        // POST /install/configure/storage - Configure Storage
        app.post<{ Body: StorageConfigInput }>(
          '/configure/storage',
          {
            schema: {
              body: StorageConfigSchema,
            },
          },
          async (request, reply) => {
            const result = await installService.configureStorage(request.body);
            const statusCode = result.success ? 200 : 400;
            return reply.status(statusCode).send(result);
          },
        );

        // POST /install/configure/cache - Configure Cache
        app.post<{ Body: CacheConfigInput }>(
          '/configure/cache',
          {
            schema: {
              body: CacheConfigSchema,
            },
          },
          async (request, reply) => {
            const result = await installService.configureCache(request.body);
            const statusCode = result.success ? 200 : 400;
            return reply.status(statusCode).send(result);
          },
        );

        // POST /install/configure/queue - Configure Queue
        app.post<{ Body: QueueConfigInput }>(
          '/configure/queue',
          {
            schema: {
              body: QueueConfigSchema,
            },
          },
          async (request, reply) => {
            const result = await installService.configureQueue(request.body);
            const statusCode = result.success ? 200 : 400;
            return reply.status(statusCode).send(result);
          },
        );

        // POST /install/finalize - Finalize bootstrap
        app.post('/finalize', async (_request: FastifyRequest, reply: FastifyReply) => {
          const result = await installService.finalizeBootstrap();
          const statusCode = result.success ? 200 : 400;
          return reply.status(statusCode).send(result);
        });

        // GET /install/health - Aggregated health check
        app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
          const health = await installService.getAdapterHealth();
          const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 207 : 503;
          return reply.status(statusCode).send(health);
        });
      },
      { prefix },
    );
  },
  {
    name: '@proctira/backend-install',
    fastify: '4.x',
    dependencies: [],
  },
);
