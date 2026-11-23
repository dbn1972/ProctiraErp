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
 *
 * PRC-M625: every route (status and health included) requires `X-Install-Token`; the plugin
 * refuses to register without a token (options.installToken / `INSTALL_TOKEN`).
 * After finalize, configure/finalize return 409 (bootstrap lock).
 */

import { createLogger } from '@proctira/logging';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import { InMemoryBootstrapStore } from './bootstrap-store';
import type { BootstrapStore } from './bootstrap-store';
import {
  createEndpointPolicy,
  parseAllowedEndpointHosts,
  type ResolveHost,
} from './endpoint-policy';
import {
  createInstallTokenFailureLimiter,
  enforceInstallToken,
  requireInstallToken,
  statusForInstallResult,
} from './install-security';
import { InstallServiceImpl } from './install-service';
import type { ConnectivityTester } from './install-service';
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
  /**
   * Shared install token required on every route (PRC-M625).
   * Falls back to INSTALL_TOKEN env. When neither is set the plugin refuses to register.
   */
  installToken?: string;
  /**
   * PRC-L568: exact hosts the operator explicitly allows to resolve to private ranges.
   * Falls back to `INSTALL_ENDPOINT_ALLOWED_HOSTS` (comma separated). Wildcards are refused.
   * The SSRF endpoint policy itself is always on for this HTTP surface.
   */
  endpointAllowedHosts?: readonly string[];
  /** PRC-L568: DNS resolver override (tests). */
  resolveHost?: ResolveHost;
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
  async function installPluginImpl(fastify: FastifyInstance, options: InstallPluginOptions) {
    const {
      prefix = '/install',
      store = new InMemoryBootstrapStore(),
      connectivityTester,
      loggerName = 'install-service',
    } = options;

    const expectedToken = requireInstallToken(options);
    const tokenFailures = createInstallTokenFailureLimiter();
    const logger = createLogger({ name: loggerName });

    const endpointPolicy = createEndpointPolicy({
      allowedPrivateHosts:
        options.endpointAllowedHosts ??
        parseAllowedEndpointHosts(process.env.INSTALL_ENDPOINT_ALLOWED_HOSTS),
      resolveHost: options.resolveHost,
    });
    const installService = new InstallServiceImpl({
      logger,
      store,
      connectivityTester,
      endpointPolicy,
    });

    // Decorate fastify instance with the service
    fastify.decorate('installService', installService);

    // Register routes under the prefix
    fastify.register(
      async function installRoutes(app) {
        const requireToken = async (request: FastifyRequest, reply: FastifyReply) => {
          if (!enforceInstallToken(request, reply, expectedToken, tokenFailures)) {
            return reply;
          }
        };

        // GET /install/status - Get bootstrap status
        app.get(
          '/status',
          {
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Fastify async preHandler
            preHandler: requireToken,
          },
          async (_request: FastifyRequest, reply: FastifyReply) => {
            const status = await installService.getBootstrapStatus();
            return reply.status(200).send(status);
          },
        );

        // POST /install/configure/cdn - Configure CDN
        app.post<{ Body: CdnConfigInput }>(
          '/configure/cdn',
          {
            schema: {
              body: CdnConfigSchema,
            },
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Fastify async preHandler
            preHandler: requireToken,
          },
          async (request, reply) => {
            const result = await installService.configureCDN(request.body);
            return reply.status(statusForInstallResult(result.success, result.error)).send(result);
          },
        );

        // POST /install/configure/database - Configure Database
        app.post<{ Body: DatabaseConfigInput }>(
          '/configure/database',
          {
            schema: {
              body: DatabaseConfigSchema,
            },
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Fastify async preHandler
            preHandler: requireToken,
          },
          async (request, reply) => {
            const result = await installService.configureDatabase(request.body);
            return reply.status(statusForInstallResult(result.success, result.error)).send(result);
          },
        );

        // POST /install/configure/storage - Configure Storage
        app.post<{ Body: StorageConfigInput }>(
          '/configure/storage',
          {
            schema: {
              body: StorageConfigSchema,
            },
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Fastify async preHandler
            preHandler: requireToken,
          },
          async (request, reply) => {
            const result = await installService.configureStorage(request.body);
            return reply.status(statusForInstallResult(result.success, result.error)).send(result);
          },
        );

        // POST /install/configure/cache - Configure Cache
        app.post<{ Body: CacheConfigInput }>(
          '/configure/cache',
          {
            schema: {
              body: CacheConfigSchema,
            },
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Fastify async preHandler
            preHandler: requireToken,
          },
          async (request, reply) => {
            const result = await installService.configureCache(request.body);
            return reply.status(statusForInstallResult(result.success, result.error)).send(result);
          },
        );

        // POST /install/configure/queue - Configure Queue
        app.post<{ Body: QueueConfigInput }>(
          '/configure/queue',
          {
            schema: {
              body: QueueConfigSchema,
            },
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Fastify async preHandler
            preHandler: requireToken,
          },
          async (request, reply) => {
            const result = await installService.configureQueue(request.body);
            return reply.status(statusForInstallResult(result.success, result.error)).send(result);
          },
        );

        // POST /install/finalize - Finalize bootstrap
        app.post(
          '/finalize',
          {
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Fastify async preHandler
            preHandler: requireToken,
          },
          async (_request: FastifyRequest, reply: FastifyReply) => {
            const result = await installService.finalizeBootstrap();
            return reply.status(statusForInstallResult(result.success, result.error)).send(result);
          },
        );

        // GET /install/health - Aggregated health check
        app.get(
          '/health',
          {
            // eslint-disable-next-line @typescript-eslint/no-misused-promises -- Fastify async preHandler
            preHandler: requireToken,
          },
          async (_request: FastifyRequest, reply: FastifyReply) => {
            const health = await installService.getAdapterHealth();
            const statusCode =
              health.status === 'healthy' ? 200 : health.status === 'degraded' ? 207 : 503;
            return reply.status(statusCode).send(health);
          },
        );
      },
      { prefix },
    );
  },
  {
    name: '@proctira/backend-install',
    fastify: '5.x',
    dependencies: [],
  },
);
