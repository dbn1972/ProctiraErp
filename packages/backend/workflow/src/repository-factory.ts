/**
 * Workflow / case repository composition.
 *
 *   - `DATABASE_URL` set → Prisma repositories (Postgres + RLS)
 *   - otherwise          → in-memory repositories (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';

import type { CaseRepository } from './case-repository.js';
import { InMemoryCaseRepository } from './in-memory-case-repository.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { PrismaCaseRepository } from './prisma-case-repository.js';
import { PrismaWorkflowRepository } from './prisma-workflow-repository.js';
import type { WorkflowRepository } from './workflow-repository.js';

export interface WorkflowRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
}

export function createWorkflowRepository(
  config: WorkflowRepositoryConfig = {},
): WorkflowRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryWorkflowRepository();
  }
  return new PrismaWorkflowRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}

export function createCaseRepository(
  config: WorkflowRepositoryConfig = {},
): CaseRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryCaseRepository();
  }
  return new PrismaCaseRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}
