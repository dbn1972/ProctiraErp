/**
 * Prefer Postgres raw-SQL repository when DATABASE_URL is set; else in-memory.
 * No Prisma on the timetable certification path.
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
} from '@proctira/database';

import {
  InMemoryTimetableOpsStore,
  PgTimetableOpsStore,
  type TimetableOpsStore,
} from './generation-store.js';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { createPgTimetableRepository, isPgTimetableEnabled } from './pg-timetable-repository.js';
import type { TimetableRepository } from './timetable-repository.js';

export function createTimetableRepository(): TimetableRepository {
  if (isPgTimetableEnabled()) {
    const pg = createPgTimetableRepository();
    assertPostgresRepositoryAvailable('timetable', pg);
    return pg;
  }
  assertInMemoryFallbackAllowed('timetable');
  return new InMemoryTimetableRepository();
}

/** G-917 jobs/absences: raw pg 041 when DATABASE_URL is set; else in-memory. */
export function createTimetableOpsStore(): TimetableOpsStore {
  if (process.env.DATABASE_URL?.trim()) {
    const pool = getSharedPgPool();
    assertPostgresRepositoryAvailable('timetable.ops', pool);
    return new PgTimetableOpsStore(pool);
  }
  assertInMemoryFallbackAllowed('timetable');
  return new InMemoryTimetableOpsStore();
}
