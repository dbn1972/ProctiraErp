/**
 * LMS repository factory — Postgres when DATABASE_URL is set, else in-memory.
 */
import { assertInMemoryFallbackAllowed } from '@proctira/database';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import type { LmsRepository } from './lms-repository.js';
import { getSharedLmsPool, PgLmsRepository } from './pg-lms-repository.js';

export function isPgLmsEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createLmsRepository(): LmsRepository {
  if (isPgLmsEnabled()) {
    const pool = getSharedLmsPool();
    if (pool) return new PgLmsRepository(pool);
  }
  assertInMemoryFallbackAllowed('lms');
  return new InMemoryLmsRepository();
}
