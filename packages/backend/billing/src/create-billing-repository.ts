/**
 * Billing repository factory (G-704): Postgres when DATABASE_URL is set, else
 * in-memory (refused in production by the persistence policy).
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
} from '@proctira/database';

import type { BillingRepository } from './billing-repository.js';
import { InMemoryBillingRepository } from './in-memory-repository.js';
import { PgBillingRepository } from './pg-billing-repository.js';

export function createBillingRepository(): BillingRepository {
  if (process.env.DATABASE_URL?.trim()) {
    const pool = getSharedPgPool();
    assertPostgresRepositoryAvailable('billing', pool);
    return new PgBillingRepository(pool);
  }
  assertInMemoryFallbackAllowed('billing');
  return new InMemoryBillingRepository();
}
