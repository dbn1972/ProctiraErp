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
