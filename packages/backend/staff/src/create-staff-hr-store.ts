/**
 * Staff HR store factory — Postgres when DATABASE_URL is set, else in-memory.
 */
import { assertInMemoryFallbackAllowed, getSharedPgPool } from '@proctira/database';

import { InMemoryStaffHrStore, type StaffHrStore } from './hr-store.js';
import { PgStaffHrStore } from './pg-hr-ops-store.js';

export function createStaffHrStore(): StaffHrStore {
  const pool = getSharedPgPool();
  if (pool) {
    return new PgStaffHrStore(pool);
  }
  assertInMemoryFallbackAllowed('staff-hr');
  return new InMemoryStaffHrStore();
}
