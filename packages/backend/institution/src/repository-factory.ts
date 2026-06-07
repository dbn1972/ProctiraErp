/**
 * Institution repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaInstitutionRepository} (Postgres + RLS)
 *   - otherwise          → {@link InMemoryInstitutionRepository} (dev / tests)
 *
 * Mirrors the student repository factory so the standalone service and the API
 * gateway compose persistence identically.
 */
import { createPrismaClient } from '@proctira/database';

import { InMemoryInstitutionRepository } from './in-memory-repository.js';
import { PrismaInstitutionRepository } from './prisma-institution-repository.js';
import type { InstitutionRepository } from './institution-repository.js';

export interface InstitutionRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
}

export function createInstitutionRepository(
  config: InstitutionRepositoryConfig = {},
): InstitutionRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryInstitutionRepository();
  }
  return new PrismaInstitutionRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}
