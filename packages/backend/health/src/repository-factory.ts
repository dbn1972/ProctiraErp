/**
 * Health repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaHealthRepository} (Postgres + RLS)
 *   - otherwise          → {@link InMemoryHealthRepository} (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';

import type { HealthRepository } from './health-repository.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';
import { PrismaHealthRepository } from './prisma-health-repository.js';

export interface HealthRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
}

export function createHealthRepository(
  config: HealthRepositoryConfig = {},
): HealthRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryHealthRepository();
  }
  return new PrismaHealthRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}
