/**
 * Audit repository factory (G-704): Postgres when DATABASE_URL is set, else
 * in-memory (dev/tests; refused in production by the persistence policy).
 */
import { assertInMemoryFallbackAllowed, getSharedPgPool } from '@proctira/database';

import type { AuditRepository } from './audit-repository.js';
import { InMemoryAuditRepository } from './in-memory-repository.js';
import { PgAuditRepository } from './pg-audit-repository.js';

export type AuditPersistence = 'postgres' | 'memory';

export function createAuditRepository(): {
  repository: AuditRepository;
  persistence: AuditPersistence;
} {
  const pool = getSharedPgPool();
  if (pool) {
    return { repository: new PgAuditRepository(pool), persistence: 'postgres' };
  }
  assertInMemoryFallbackAllowed('audit');
  return { repository: new InMemoryAuditRepository(), persistence: 'memory' };
}
