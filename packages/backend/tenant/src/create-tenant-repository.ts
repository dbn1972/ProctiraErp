/**
 * Tenant-lifecycle repository factory (G-704): Postgres when DATABASE_URL is
 * set, else in-memory (dev/tests; refused in production by the persistence policy).
 */
import { assertInMemoryFallbackAllowed, getSharedPgPool } from '@proctira/database';

import { InMemoryTenantRepository } from './in-memory-repository.js';
import { PgTenantRepository } from './pg-tenant-repository.js';
import type { TenantRepository } from './tenant-repository.js';

export type TenantPersistence = 'postgres' | 'memory';

export function createTenantRepository(): {
  repository: TenantRepository;
  persistence: TenantPersistence;
} {
  const pool = getSharedPgPool();
  if (pool) {
    return { repository: new PgTenantRepository(pool), persistence: 'postgres' };
  }
  assertInMemoryFallbackAllowed('tenant-lifecycle');
  return { repository: new InMemoryTenantRepository(), persistence: 'memory' };
}
