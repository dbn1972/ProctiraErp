/**
 * Attendance repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaAttendanceRepository} (Postgres + RLS)
 *   - otherwise          → {@link InMemoryAttendanceRepository} (dev / tests)
 *
 * Mirrors the institution/student repository factories so the standalone
 * service and the API gateway compose persistence identically.
 */
import { createPrismaClient } from '@proctira/database';

import type { AttendanceRepository } from './attendance-repository.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
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
    return new InMemoryAttendanceRepository();
  }
  return new PrismaAttendanceRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}
