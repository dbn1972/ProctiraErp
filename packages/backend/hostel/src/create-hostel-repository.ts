/**
 * Hostel repository factory — Postgres when DATABASE_URL is set, else in-memory.
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import type { HostelRepository } from './hostel-repository.js';
import { InMemoryHostelRepository } from './in-memory-repository.js';
import { getSharedHostelPool, PgHostelRepository } from './pg-hostel-repository.js';

export function isPgHostelEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createHostelRepository(): HostelRepository {
  if (isPgHostelEnabled()) {
    const pool = getSharedHostelPool();
    assertPostgresRepositoryAvailable('hostel', pool);
    return new PgHostelRepository(pool);
  }
  assertInMemoryFallbackAllowed('hostel');
  return new InMemoryHostelRepository();
}
