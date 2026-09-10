/**
 * Student repository composition.
 *
 * Selects and assembles the concrete {@link StudentRepository} for a running
 * service based on configuration/environment:
 *
 *   - `DATABASE_URL` set  → {@link PrismaStudentRepository} (Postgres + RLS)
 *   - `+ REDIS_URL` set   → wrapped in {@link CachedStudentRepository}
 *   - neither set         → {@link InMemoryStudentRepository} (dev / tests)
 *
 * Keeping this in one place means the standalone service and the API gateway
 * compose the repository identically, and tests can call it with explicit
 * config instead of relying on process env.
 */
import { CacheClient } from '@proctira/cache';
import { assertInMemoryFallbackAllowed, createPrismaClient } from '@proctira/database';

import { CachedStudentRepository } from './cached-student-repository.js';
import { InMemoryStudentRepository } from './in-memory-repository.js';
import { PrismaStudentRepository } from './prisma-student-repository.js';
import type { StudentRepository } from './student-repository.js';

export interface StudentRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
  /** Redis connection string. Defaults to `process.env.REDIS_URL`. */
  redisUrl?: string;
}

/**
 * Builds the student repository appropriate for the current configuration.
 */
export function createStudentRepository(config: StudentRepositoryConfig = {}): StudentRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  const redisUrl = config.redisUrl ?? process.env['REDIS_URL'];

  // No database configured → in-memory store (development / unit tests).
  if (!databaseUrl) {
    assertInMemoryFallbackAllowed('student');
    return new InMemoryStudentRepository();
  }

  const base: StudentRepository = new PrismaStudentRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );

  // Optional Redis read-through cache in front of the Prisma repository.
  if (redisUrl) {
    return new CachedStudentRepository(base, new CacheClient({ redisUrl }));
  }

  return base;
}
