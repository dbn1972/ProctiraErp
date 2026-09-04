/**
 * Fastify Tenant Plugin
 *
 * Registers an onRequest hook that:
 * 1. Resolves the tenant ID from the incoming request
 * 2. Sets the PostgreSQL session variable `app.current_tenant_id` for RLS
 * 3. Decorates the request with `tenantId` for downstream handlers
 *
 * This plugin must be registered AFTER the auth plugin (so JWT claims are available)
 * but BEFORE any route handlers that access tenant-scoped data.
 */

import { createLogger } from '@proctira/logging';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import {
  resolveTenantId,
  TenantResolutionError,
  type TenantResolutionOptions,
} from './tenant-resolution.js';

const logger = createLogger({ name: 'tenant-plugin' });

/**
 * Options for the tenant Fastify plugin.
 */
export interface TenantPluginOptions extends TenantResolutionOptions {
  /**
   * Routes to exclude from tenant resolution (e.g., health checks, public endpoints).
   * Supports exact paths and prefix matching with trailing wildcard.
   * Example: ['/health', '/api/v1/public/*']
   */
  excludePaths?: string[];

  /**
   * Custom function to get a database client for setting the session variable.
   * If not provided, the plugin will look for `fastify.prisma` or `request.server.prisma`.
   */
  getDbClient?: (request: FastifyRequest) => {
    $executeRawUnsafe: (query: string) => Promise<unknown>;
  } | undefined;

  /**
   * Whether to look up the tenant slug in the database to resolve to a UUID.
   * When true, subdomain-resolved slugs will be looked up in the tenants table.
   * Default: true
   */
  resolveSlugToId?: boolean;
}

/**
 * Checks if a request path matches any of the excluded paths.
 */
function isExcludedPath(path: string, excludePaths: string[]): boolean {
  const pathname = path.split('?')[0] ?? path;
  for (const excluded of excludePaths) {
    if (excluded.endsWith('/*')) {
      const prefix = excluded.slice(0, -2);
      if (pathname.startsWith(prefix)) return true;
    } else if (pathname === excluded) {
      return true;
    }
  }
  return false;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    tenantSource?: 'jwt' | 'header' | 'subdomain';
  }

  interface FastifyInstance {
    prisma?: {
      $executeRawUnsafe: (query: string) => Promise<unknown>;
      tenant?: {
        findUnique: (args: { where: { slug: string } }) => Promise<{ id: string } | null>;
      };
    };
  }
}

/**
 * Fastify plugin that resolves tenant context on every request and sets
 * the PostgreSQL session variable for Row-Level Security enforcement.
 */
export const tenantPlugin = fp(
  async function tenantPluginImpl(
    fastify: FastifyInstance,
    options: TenantPluginOptions,
  ) {
    const {
      excludePaths = ['/health', '/healthz', '/ready', '/metrics'],
      getDbClient,
      resolveSlugToId = true,
      ...resolutionOptions
    } = options;

    // Decorate request with tenantId and tenantSource
    if (!fastify.hasRequestDecorator('tenantId')) {
      fastify.decorateRequest('tenantId', undefined);
    }
    if (!fastify.hasRequestDecorator('tenantSource')) {
      fastify.decorateRequest('tenantSource', undefined);
    }

    fastify.addHook(
      'onRequest',
      async function tenantResolutionHook(
        request: FastifyRequest,
        reply: FastifyReply,
      ) {
        // Skip excluded paths
        if (isExcludedPath(request.url, excludePaths)) {
          return;
        }

        try {
          const resolution = resolveTenantId(request, resolutionOptions);
          let tenantId = resolution.tenantId;

          // If resolved from subdomain (slug), look up the actual UUID
          if (resolution.source === 'subdomain' && resolveSlugToId) {
            const db = getDbClient?.(request) ?? fastify.prisma;
            if (db && 'tenant' in db && db.tenant) {
              const tenant = await (db.tenant as { findUnique: (args: { where: { slug: string } }) => Promise<{ id: string } | null> }).findUnique({
                where: { slug: tenantId },
              });
              if (!tenant) {
                throw new TenantResolutionError(
                  `Tenant not found for subdomain: ${tenantId}`,
                );
              }
              tenantId = tenant.id;
            }
            // If no DB client available, use slug as-is (useful in testing)
          }

          request.tenantId = tenantId;
          request.tenantSource = resolution.source;

          // Set PostgreSQL session variable for RLS
          const db = getDbClient?.(request) ?? fastify.prisma;
          if (db) {
            await db.$executeRawUnsafe(
              `SELECT set_config('app.current_tenant_id', '${tenantId}', true)`,
            );
          }

          logger.debug(
            { tenantId, source: resolution.source, path: request.url },
            'Tenant resolved',
          );
        } catch (error) {
          if (error instanceof TenantResolutionError) {
            logger.warn(
              { path: request.url, error: error.message },
              'Tenant resolution failed',
            );
            return reply.status(error.statusCode).send({
              code: error.code,
              message: error.message,
              statusCode: error.statusCode,
            });
          }
          throw error;
        }
      },
    );
  },
  {
    name: '@proctira/tenant',
    fastify: '4.x',
  },
);
