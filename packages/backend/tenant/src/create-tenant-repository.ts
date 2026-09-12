/**
 * Tenant-lifecycle repository factory (G-704): Postgres when DATABASE_URL is
 * set, else in-memory (dev/tests; refused in production by the persistence policy).
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
} from '@proctira/database';

import { InMemoryTenantRepository } from './in-memory-repository.js';
import { PgTenantRepository } from './pg-tenant-repository.js';
import type { TenantRepository } from './tenant-repository.js';

export type TenantPersistence = 'postgres' | 'memory';

export function createTenantRepository(): {
  repository: TenantRepository;
  persistence: TenantPersistence;
} {
  if (process.env.DATABASE_URL?.trim()) {
    const pool = getSharedPgPool();
    assertPostgresRepositoryAvailable('tenant-lifecycle', pool);
    return { repository: new PgTenantRepository(pool), persistence: 'postgres' };
  }
  assertInMemoryFallbackAllowed('tenant-lifecycle');
  return { repository: new InMemoryTenantRepository(), persistence: 'memory' };
}
