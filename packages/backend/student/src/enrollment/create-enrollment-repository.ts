/**
 * Enrollment repository composition (G-701).
 *
 *   - `DATABASE_URL` set → {@link PgEnrollmentRepository} (raw pg + RLS)
 *   - otherwise          → {@link InMemoryEnrollmentRepository} (dev / tests)
 */
import { assertInMemoryFallbackAllowed } from '@proctira/database';
import pg from 'pg';

import type { EnrollmentRepository } from './enrollment-repository.js';
import { InMemoryEnrollmentRepository } from './in-memory-enrollment-repository.js';
import { PgEnrollmentRepository } from './pg-enrollment-repository.js';

const { Pool } = pg;

let sharedPool: pg.Pool | null = null;

export interface EnrollmentRepositoryConfig {
  databaseUrl?: string;
}

export function createEnrollmentRepository(
  config: EnrollmentRepositoryConfig = {},
): EnrollmentRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    assertInMemoryFallbackAllowed('student.enrollment');
    return new InMemoryEnrollmentRepository();
  }
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: databaseUrl });
  }
  return new PgEnrollmentRepository(sharedPool);
}
