/**
 * Billing repository factory (G-704): Postgres when DATABASE_URL is set, else
 * in-memory (refused in production by the persistence policy).
 */
import { assertInMemoryFallbackAllowed, getSharedPgPool } from '@proctira/database';

import type { BillingRepository } from './billing-repository.js';
import { InMemoryBillingRepository } from './in-memory-repository.js';
import { PgBillingRepository } from './pg-billing-repository.js';

export function createBillingRepository(): BillingRepository {
  const pool = getSharedPgPool();
  if (pool) return new PgBillingRepository(pool);
  assertInMemoryFallbackAllowed('billing');
  return new InMemoryBillingRepository();
}
