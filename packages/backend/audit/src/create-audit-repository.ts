/**
 * Audit repository factory (G-704): Postgres when DATABASE_URL is set, else
 * in-memory (dev/tests; refused in production by the persistence policy).
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
} from '@proctira/database';

import type { AuditRepository } from './audit-repository.js';
import { InMemoryAuditRepository } from './in-memory-repository.js';
import { PgAuditRepository } from './pg-audit-repository.js';

export type AuditPersistence = 'postgres' | 'memory';

export function createAuditRepository(): {
  repository: AuditRepository;
  persistence: AuditPersistence;
} {
  if (process.env.DATABASE_URL?.trim()) {
    const pool = getSharedPgPool();
    assertPostgresRepositoryAvailable('audit', pool);
    return { repository: new PgAuditRepository(pool), persistence: 'postgres' };
  }
  assertInMemoryFallbackAllowed('audit');
  return { repository: new InMemoryAuditRepository(), persistence: 'memory' };
}
