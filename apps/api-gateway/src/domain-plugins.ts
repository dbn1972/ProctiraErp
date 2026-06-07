/**
 * In-process domain plugins (monolith mode).
 *
 * The platform's intended topology runs the backend domain logic *inside* the
 * gateway as Fastify plugins (see docker-compose header). This module registers
 * those domain plugins under the `/api/v1` version prefix, returning the set of
 * route prefixes it handled so the service-router can skip them (and only proxy
 * the domains that are deployed as separate services).
 *
 * Adding a domain is a one-liner in `DOMAIN_REGISTRARS`: give it a prefix and a
 * registrar that mounts the domain's Fastify plugin with a real (Prisma-backed)
 * repository. Repositories self-select Prisma vs in-memory from `DATABASE_URL`,
 * so the same code runs in production (Postgres + RLS) and in dev/tests.
 */
import type { FastifyInstance } from 'fastify';
import { createStudentRepository, studentPlugin } from '@proctira/backend-student';

import type { GatewayConfig } from './config.js';

/** A registrar mounts one domain's plugin onto an `/api/v1`-scoped instance. */
interface DomainRegistrar {
  /** Route prefix under /api/v1 (e.g. '/students'). */
  prefix: string;
  /** Registers the domain plugin onto the provided (already /api/v1-scoped) scope. */
  register: (scope: FastifyInstance, config: GatewayConfig) => Promise<void>;
}

/**
 * Domains served in-process. Each entry is fully wired with a persistence-backed
 * repository. Domains NOT listed here fall through to the service-router, which
 * proxies them to a standalone service (when SERVICE_ROUTES targets one).
 */
const DOMAIN_REGISTRARS: DomainRegistrar[] = [
  {
    prefix: '/students',
    register: async (scope) => {
      // createStudentRepository → Prisma (+ optional Redis cache) when
      // DATABASE_URL is set, else in-memory. Reads RLS-safely via
      // withTenantTransaction using the request's resolved tenantId.
      const repository = createStudentRepository();
      await scope.register(studentPlugin, { repository, prefix: '/students' });
    },
  },
];

/**
 * Registers all in-process domain plugins and returns the prefixes handled,
 * so the caller can exclude them from the proxy router.
 */
export async function registerDomainPlugins(
  app: FastifyInstance,
  config: GatewayConfig,
  versionPrefix = '/api/v1',
): Promise<string[]> {
  const handled: string[] = [];

  for (const domain of DOMAIN_REGISTRARS) {
    // Encapsulate each domain under the version prefix so its routes resolve at
    // `/api/v1<prefix>` while inheriting the root auth + tenant hooks.
    await app.register(
      async (scope) => {
        await domain.register(scope, config);
      },
      { prefix: versionPrefix },
    );
    handled.push(domain.prefix);
    app.log.info({ domain: domain.prefix }, 'Registered in-process domain plugin');
  }

  return handled;
}
