/**
 * Scholarship repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaScholarshipRepository} (Postgres + RLS)
 *   - otherwise          → {@link InMemoryScholarshipRepository} (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';

import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { PrismaScholarshipRepository } from './prisma-scholarship-repository.js';
import type { ScholarshipRepository } from './scholarship-repository.js';

export interface ScholarshipRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
}

export function createScholarshipRepository(
  config: ScholarshipRepositoryConfig = {},
): ScholarshipRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryScholarshipRepository();
  }
  return new PrismaScholarshipRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}
