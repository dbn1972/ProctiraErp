/**
 * Staff HR store factory — Postgres when DATABASE_URL is set, else in-memory.
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
} from '@proctira/database';

import { InMemoryStaffHrStore, type StaffHrStore } from './hr-store.js';
import { PgStaffHrStore } from './pg-hr-ops-store.js';

export function createStaffHrStore(): StaffHrStore {
  if (process.env.DATABASE_URL?.trim()) {
    const pool = getSharedPgPool();
    assertPostgresRepositoryAvailable('staff-hr', pool);
    return new PgStaffHrStore(pool);
  }
  assertInMemoryFallbackAllowed('staff-hr');
  return new InMemoryStaffHrStore();
}
