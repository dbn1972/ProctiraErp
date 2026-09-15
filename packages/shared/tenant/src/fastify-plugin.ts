/**
 * Fastify Tenant Plugin
 *
 * Runs after authentication and before tenant-scoped handlers. Authenticated
 * requests are bound to a verified JWT tenant UUID; client headers and known
 * tenant subdomains are comparison inputs only.
 */

import { bindTenantGucPrisma } from '@proctira/database';
import { createLogger } from '@proctira/logging';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import {
  isAuthenticatedRequest,
  isValidUuid,
  resolveTenantId,
  resolveTenantSlugFromHostname,
  TenantContextMismatchError,
  TenantResolutionError,
  type TenantResolutionOptions,
} from './tenant-resolution.js';

const logger = createLogger({ name: 'tenant-plugin' });

export type TenantSlugResolver = (slug: string) => Promise<string | undefined>;

type TenantFindUnique = {
  findUnique: (args: { where: { slug: string } }) => Promise<{ id: string } | null>;
};

type TenantDbClient = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  tenant?: TenantFindUnique;
};

/** Options for the tenant Fastify plugin. */
export interface TenantPluginOptions extends TenantResolutionOptions {
  /** Routes to exclude from tenant resolution. Supports trailing `/*`. */
  excludePaths?: string[];

  /** Optional database client used for tenant GUC binding and legacy slug lookup. */
  getDbClient?: (request: FastifyRequest) => TenantDbClient | undefined;

  /**
   * Whether hostname slugs may be resolved through a trusted server-side
   * lookup. Authenticated hostname candidates fail closed if lookup is disabled.
   * Default: true.
   */
  resolveSlugToId?: boolean;

  /**
   * Trusted control-plane lookup for a supported tenant slug. Returning
   * `undefined` means the hostname is not a supported tenant slug.
   */
  resolveTenantSlug?: TenantSlugResolver;
}

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

function getTenantFinder(db: unknown): TenantFindUnique | undefined {
  if (db && typeof db === 'object' && 'tenant' in db) {
    const tenant = (db as { tenant?: TenantFindUnique }).tenant;
    if (tenant && typeof tenant.findUnique === 'function') {
      return tenant;
    }
  }
  return undefined;
}

async function resolveSlugViaTrustedLookup(
  slug: string,
  db: unknown,
  resolver: TenantSlugResolver | undefined,
  options: { required: boolean },
): Promise<string | undefined> {
  let tenantId: string | undefined;

  if (resolver) {
    tenantId = await resolver(slug);
  } else {
    const finder = getTenantFinder(db);
    if (!finder) {
      if (options.required) {
        throw new TenantResolutionError('Trusted tenant slug lookup is unavailable');
      }
      return undefined;
    }
    tenantId = (await finder.findUnique({ where: { slug } }))?.id;
  }

  if (!tenantId) return undefined;
  if (!isValidUuid(tenantId)) {
    throw new TenantResolutionError('Trusted tenant slug lookup returned an invalid tenant ID');
  }
  return tenantId.toLowerCase();
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    tenantSource?: 'jwt' | 'header' | 'subdomain';
  }

  interface FastifyInstance {
    prisma?: TenantDbClient;
  }
}

/** Resolve and bind tenant context for each non-excluded request. */
export const tenantPlugin = fp(
  async function tenantPluginImpl(fastify: FastifyInstance, options: TenantPluginOptions) {
    const {
      excludePaths = ['/health', '/healthz', '/ready', '/metrics'],
      getDbClient,
      resolveSlugToId = true,
      resolveTenantSlug,
      ...resolutionOptions
    } = options;

    if (!fastify.hasRequestDecorator('tenantId')) {
      fastify.decorateRequest('tenantId', undefined);
    }
    if (!fastify.hasRequestDecorator('tenantSource')) {
      fastify.decorateRequest('tenantSource', undefined);
    }

    fastify.addHook(
      'onRequest',
      async function tenantResolutionHook(request: FastifyRequest, reply: FastifyReply) {
        const path = request.url.split('?')[0]!;
        if (isExcludedPath(path, excludePaths)) {
          return;
        }

        try {
          const resolution = resolveTenantId(request, resolutionOptions);
          let tenantId = resolution.tenantId;
          const authenticated = isAuthenticatedRequest(request);
          const db = getDbClient?.(request) ?? fastify.prisma;

          if (resolution.source === 'subdomain') {
            if (!resolveSlugToId) {
              // Anonymous resolver consumers may deliberately retain the slug.
              // Authenticated requests cannot reach this branch because they
              // require a JWT tenant claim in resolveTenantId().
            } else {
              const lookedUp = await resolveSlugViaTrustedLookup(
                tenantId,
                db,
                resolveTenantSlug,
                { required: authenticated },
              );
              if (lookedUp) {
                tenantId = lookedUp;
              } else if (resolveTenantSlug || getTenantFinder(db)) {
                throw new TenantResolutionError('Tenant subdomain is not recognized');
              }
            }
          }

          if (authenticated && resolution.source === 'jwt') {
            const baseDomain =
              resolutionOptions.baseDomain ??
              process.env['TENANT_BASE_DOMAIN'] ??
              'proctira.org';
            const hostSlug = resolveTenantSlugFromHostname(request, baseDomain);

            if (hostSlug) {
              if (!resolveSlugToId) {
                throw new TenantContextMismatchError(
                  'Authenticated tenant hostname context cannot be verified',
                );
              }

              let hostTenantId: string | undefined;
              try {
                hostTenantId = await resolveSlugViaTrustedLookup(
                  hostSlug,
                  db,
                  resolveTenantSlug,
                  { required: true },
                );
              } catch (error) {
                if (error instanceof TenantResolutionError) {
                  throw new TenantContextMismatchError(
                    'Authenticated tenant hostname context cannot be verified',
                  );
                }
                throw error;
              }

              // Only slugs recognized by the trusted control-plane lookup are
              // tenant identities. Infrastructure/unknown host labels are not.
              if (hostTenantId && hostTenantId !== tenantId) {
                throw new TenantContextMismatchError(
                  'Verified JWT tenant does not match hostname tenant context',
                );
              }
            }
          }

          request.tenantId = tenantId;
          request.tenantSource = resolution.source;

          if (db) {
            await bindTenantGucPrisma(db, tenantId);
          }

          logger.debug(
            { tenantId, source: resolution.source, path },
            'Tenant resolved',
          );
        } catch (error) {
          if (error instanceof TenantResolutionError) {
            logger.warn({ path, code: error.code }, 'Tenant resolution failed');
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
