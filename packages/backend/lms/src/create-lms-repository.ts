/**
 * LMS repository factory — Postgres when DATABASE_URL is set, else in-memory.
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

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
    assertPostgresRepositoryAvailable('lms', pool);
    return new PgLmsRepository(pool);
  }
  assertInMemoryFallbackAllowed('lms');
  return new InMemoryLmsRepository();
}
