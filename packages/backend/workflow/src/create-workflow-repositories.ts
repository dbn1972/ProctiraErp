/**
 * Workflow engine repository factory (G-715) — Postgres when `DATABASE_URL`
 * is set (db/sql/025), otherwise in-memory under the shared fallback policy.
 */
import { assertInMemoryFallbackAllowed, getSharedPgPool } from '@proctira/database';

import type { CaseRepository } from './case-repository.js';
import { InMemoryCaseRepository } from './in-memory-case-repository.js';
import { InMemoryWorkflowRepository } from './in-memory-repository.js';
import { PgCaseRepository, PgWorkflowRepository } from './pg-workflow-repository.js';
import type { WorkflowRepository } from './workflow-repository.js';

export interface WorkflowRepositories {
  repository: WorkflowRepository;
  caseRepository: CaseRepository;
}

export function createWorkflowRepositories(databaseUrl?: string): WorkflowRepositories {
  const pool = getSharedPgPool(databaseUrl);
  if (pool) {
    return {
      repository: new PgWorkflowRepository(pool),
      caseRepository: new PgCaseRepository(pool),
    };
  }
  assertInMemoryFallbackAllowed('workflow-engine');
  return {
    repository: new InMemoryWorkflowRepository(),
    caseRepository: new InMemoryCaseRepository(),
  };
}
