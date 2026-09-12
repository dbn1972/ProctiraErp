/**
 * Circular store factory — Postgres when DATABASE_URL is set, else in-memory.
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
} from '@proctira/database';

import { InMemoryCircularStore, type CircularStore } from './circular-store.js';
import { PgCircularStore } from './pg-circular-store.js';

export function createCircularStore(): CircularStore {
  if (process.env.DATABASE_URL?.trim()) {
    const pool = getSharedPgPool();
    assertPostgresRepositoryAvailable('communication-circulars', pool);
    return new PgCircularStore(pool);
  }
  assertInMemoryFallbackAllowed('communication-circulars');
  return new InMemoryCircularStore();
}
