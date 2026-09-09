/**
 * Circular store factory — Postgres when DATABASE_URL is set, else in-memory.
 */
import { assertInMemoryFallbackAllowed, getSharedPgPool } from '@proctira/database';

import { InMemoryCircularStore, type CircularStore } from './circular-store.js';
import { PgCircularStore } from './pg-circular-store.js';

export function createCircularStore(): CircularStore {
  const pool = getSharedPgPool();
  if (pool) {
    return new PgCircularStore(pool);
  }
  assertInMemoryFallbackAllowed('communication-circulars');
  return new InMemoryCircularStore();
}
