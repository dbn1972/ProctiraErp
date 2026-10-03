/**
 * Scholarship repository factory — Postgres when DATABASE_URL is set, else in-memory.
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { getSharedScholarshipPool, PgScholarshipRepository } from './pg-scholarship-repository.js';
import {
  InMemoryScholarshipFeeOutbox,
  PgScholarshipFeeOutbox,
  type ScholarshipFeeOutbox,
} from './scholarship-fee-outbox.js';
import type { ScholarshipRepository } from './scholarship-repository.js';

export function isPgScholarshipEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createScholarshipRepository(): ScholarshipRepository {
  if (isPgScholarshipEnabled()) {
    const pool = getSharedScholarshipPool();
    assertPostgresRepositoryAvailable('scholarship', pool);
    return new PgScholarshipRepository(pool);
  }
  assertInMemoryFallbackAllowed('scholarship');
  return new InMemoryScholarshipRepository();
}

/**
 * PRC-H084: disbursement->fees outbox. Pg targets `scholarship_fee_outbox`; if that
 * table is absent, `isAvailable()` is false and the service keeps the legacy path.
 */
export function createScholarshipFeeOutbox(): ScholarshipFeeOutbox {
  if (isPgScholarshipEnabled()) {
    const pool = getSharedScholarshipPool();
    assertPostgresRepositoryAvailable('scholarship', pool);
    return new PgScholarshipFeeOutbox(pool);
  }
  return new InMemoryScholarshipFeeOutbox();
}
