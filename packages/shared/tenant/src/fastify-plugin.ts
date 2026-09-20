/**
 * Fastify Tenant Plugin
 *
 * Registers an onRequest hook that:
 * 1. Resolves the tenant ID from the incoming request
 * 2. Binds the canonical PostgreSQL GUC `app.tenant_id` for RLS (legacy alias synced)
 * 3. Decorates the request with `tenantId` for downstream handlers
 *
 * This plugin must be registered AFTER the auth plugin (so JWT claims are available)
 * but BEFORE any route handlers that access tenant-scoped data.
 *
 * W1-SEC-01: Authenticated tenant routes require a verified UUID JWT claim or a
 * trusted slug→UUID database lookup. Raw hostname slugs are never accepted as
 * tenant identity for authenticated principals when lookup is disabled/unavailable.
 */

import { bindTenantGucPrisma } from '@proctira/database';
import { createLogger } from '@proctira/logging';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import {
  isAuthenticatedRequest,
  isValidUuid,
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

  /** Additional narrow exclusion predicate supplied by trusted composition. */
  excludeRequest?: (request: FastifyRequest) => boolean;

  /**
   * Custom function to get a database client for setting the session variable.
   * If not provided, the plugin will look for `fastify.prisma` or `request.server.prisma`.
   */
  getDbClient?: (request: FastifyRequest) =>
    | {
        $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
      }
    | undefined;

  /**
   * Whether to look up the tenant slug in the database to resolve to a UUID.
   * When true, subdomain-resolved slugs will be looked up in the tenants table.
   * Required for authenticated subdomain resolution (W1-SEC-01).
   * Default: true
   */
  resolveSlugToId?: boolean;
}

/**
 * Checks if a request path matches any of the excluded paths.
 */
function isExcludedPath(path: string, excludePaths: string[]): boolean {
  for (const excluded of excludePaths) {
    if (excluded.endsWith('/*')) {
      const prefix = excluded.slice(0, -2);
      if (path.startsWith(prefix)) return true;
    } else if (path === excluded) {
      return true;
    }
  }
  return false;
}

type TenantFindUnique = {
  findUnique: (args: { where: { slug: string } }) => Promise<{ id: string } | null>;
};

function getTenantFinder(
  db: unknown,
): TenantFindUnique | undefined {
  if (db && typeof db === 'object' && 'tenant' in db) {
    const tenant = (db as { tenant?: TenantFindUnique }).tenant;
    if (tenant && typeof tenant.findUnique === 'function') {
      return tenant;
    }
  }
  return undefined;
}

/**
 * Resolve a hostname slug to a canonical tenant UUID via DB.
 * @throws TenantResolutionError when lookup is required but unavailable/fails
 */
async function resolveSlugViaTrustedLookup(
  slug: string,
  db: unknown,
  options: { required: boolean },
): Promise<string | undefined> {
  const finder = getTenantFinder(db);
  if (!finder) {
    if (options.required) {
      throw new TenantResolutionError(
        'Authenticated tenant routes require verified UUID claim or trusted slug→UUID lookup (lookup unavailable)',
      );
    }
    return undefined;
  }

  const tenant = await finder.findUnique({ where: { slug } });
  if (!tenant) {
    throw new TenantResolutionError(`Tenant not found for subdomain: ${slug}`);
  }
  if (!isValidUuid(tenant.id)) {
    throw new TenantResolutionError(
      `Trusted slug lookup returned non-UUID tenant id for subdomain: ${slug}`,
    );
  }
  return tenant.id;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    tenantSource?: 'jwt' | 'header' | 'subdomain';
  }

  interface FastifyInstance {
    prisma?: {
      $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
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
  async function tenantPluginImpl(fastify: FastifyInstance, options: TenantPluginOptions) {
    const {
      excludePaths = ['/health', '/healthz', '/ready', '/metrics'],
      excludeRequest,
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
      async function tenantResolutionHook(request: FastifyRequest, reply: FastifyReply) {
        // Skip explicitly public paths selected by trusted gateway composition.
        if (excludeRequest?.(request) || isExcludedPath(request.url, excludePaths)) {
          return;
        }

        try {
          const resolution = resolveTenantId(request, resolutionOptions);
          let tenantId = resolution.tenantId;
          const authenticated = isAuthenticatedRequest(request);
          const db = getDbClient?.(request) ?? fastify.prisma;

          // Subdomain yields a slug — authenticated principals must map via trusted lookup.
          if (resolution.source === 'subdomain') {
            if (authenticated) {
              if (!resolveSlugToId) {
                throw new TenantResolutionError(
                  'Authenticated tenant routes require verified UUID claim or trusted slug→UUID lookup',
                );
              }
              const lookedUp = await resolveSlugViaTrustedLookup(tenantId, db, {
                required: true,
              });
              tenantId = lookedUp!;
            } else if (resolveSlugToId) {
              const lookedUp = await resolveSlugViaTrustedLookup(tenantId, db, {
                required: false,
              });
              if (lookedUp) {
                tenantId = lookedUp;
              }
              // If no DB client available, use slug as-is (useful in testing / anonymous)
            }
          } else if (
            resolution.source === 'jwt' &&
            authenticated &&
            resolveSlugToId &&
            typeof request.hostname === 'string'
          ) {
            // When JWT UUID and host slug both present, reject if trusted lookup
            // yields a different tenant UUID (conflicting identities).
            const host = request.hostname || request.headers['host'];
            if (host && typeof host === 'string') {
              const baseDomain =
                resolutionOptions.baseDomain ??
                process.env['TENANT_BASE_DOMAIN'] ??
                'proctira.org';
              const hostname = host.split(':')[0]!;
              if (hostname.endsWith(`.${baseDomain}`)) {
                const slug = hostname.slice(0, -(baseDomain.length + 1));
                if (slug.length > 0 && !slug.includes('.')) {
                  const finder = getTenantFinder(db);
                  if (finder) {
                    const tenant = await finder.findUnique({ where: { slug } });
                    if (tenant && isValidUuid(tenant.id) && tenant.id !== tenantId) {
                      throw new TenantResolutionError(
                        `Conflicting tenant identities: JWT claim (${tenantId}) does not match host slug (${slug} → ${tenant.id})`,
                      );
                    }
                  }
                }
              }
            }
          }

          request.tenantId = tenantId;
          request.tenantSource = resolution.source;

          // W1-DATA-12 / G-720: bind canonical app.tenant_id (+ legacy alias) as a parameter.
          if (db) {
            await bindTenantGucPrisma(db, tenantId);
          }

          logger.debug(
            { tenantId, source: resolution.source, path: request.url },
            'Tenant resolved',
          );
        } catch (error) {
          if (error instanceof TenantResolutionError) {
            logger.warn({ path: request.url, error: error.message }, 'Tenant resolution failed');
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
    fastify: '5.x',
  },
);
