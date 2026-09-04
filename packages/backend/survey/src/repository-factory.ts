/**
 * Survey repository composition.
 *
 *   - `DATABASE_URL` set → Prisma-backed repositories (Postgres + RLS)
 *   - otherwise          → In-memory repositories (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';

import {
  InMemoryDistributionRepository,
  InMemoryInstitutionLookup,
  InMemorySubmissionRepository,
  InMemorySurveyRepository,
} from './in-memory-repository.js';
import {
  PrismaDistributionRepository,
  PrismaInstitutionLookup,
  PrismaSubmissionRepository,
  PrismaSurveyRepository,
} from './prisma-survey-repository.js';
import type {
  DistributionRepository,
  InstitutionLookup,
  SubmissionRepository,
  SurveyRepository,
} from './survey-repository.js';

export interface SurveyRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
}

function resolveDatabaseUrl(config: SurveyRepositoryConfig): string | undefined {
  return config.databaseUrl ?? process.env['DATABASE_URL'];
}

export function createSurveyRepository(
  config: SurveyRepositoryConfig = {},
): SurveyRepository {
  const databaseUrl = resolveDatabaseUrl(config);
  if (!databaseUrl) {
    return new InMemorySurveyRepository();
  }
  return new PrismaSurveyRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}

export function createDistributionRepository(
  config: SurveyRepositoryConfig = {},
): DistributionRepository {
  const databaseUrl = resolveDatabaseUrl(config);
  if (!databaseUrl) {
    return new InMemoryDistributionRepository();
  }
  return new PrismaDistributionRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}

export function createSubmissionRepository(
  config: SurveyRepositoryConfig = {},
): SubmissionRepository {
  const databaseUrl = resolveDatabaseUrl(config);
  if (!databaseUrl) {
    return new InMemorySubmissionRepository();
  }
  return new PrismaSubmissionRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}

export function createInstitutionLookup(
  config: SurveyRepositoryConfig = {},
): InstitutionLookup {
  const databaseUrl = resolveDatabaseUrl(config);
  if (!databaseUrl) {
    return new InMemoryInstitutionLookup();
  }
  return new PrismaInstitutionLookup(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}
