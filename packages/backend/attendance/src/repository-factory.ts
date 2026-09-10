/**
 * Attendance repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaAttendanceRepository} (Postgres + RLS)
 *   - otherwise          → {@link InMemoryAttendanceRepository} (dev / tests)
 *
 * Mirrors the institution/student repository factories so the standalone
 * service and the API gateway compose persistence identically.
 */
import {
  assertInMemoryFallbackAllowed,
  createPrismaClient,
  getSharedPgPool,
} from '@proctira/database';

import type { AttendanceRepository } from './attendance-repository.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import {
  InMemoryAttendanceOpsStore,
  PgAttendanceOpsStore,
  type AttendanceOpsStore,
} from './ops-store.js';
import { PrismaAttendanceRepository } from './prisma-attendance-repository.js';

export interface AttendanceRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
}

export function createAttendanceRepository(
  config: AttendanceRepositoryConfig = {},
): AttendanceRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    assertInMemoryFallbackAllowed('attendance');
    return new InMemoryAttendanceRepository();
  }
  return new PrismaAttendanceRepository(createPrismaClient({ datasourceUrl: databaseUrl }));
}

/** G-919 ops tables (042) — raw pg when DATABASE_URL set; else in-memory. */
export function createAttendanceOpsStore(
  config: AttendanceRepositoryConfig = {},
): AttendanceOpsStore {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  const pool = getSharedPgPool(databaseUrl);
  if (!pool) {
    assertInMemoryFallbackAllowed('attendance');
    return new InMemoryAttendanceOpsStore();
  }
  return new PgAttendanceOpsStore(pool);
}
