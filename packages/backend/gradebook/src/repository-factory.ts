/**
 * Prefer Postgres raw-SQL repository when DATABASE_URL is set; else in-memory.
 * No Prisma on the gradebook certification path.
 */
import { assertInMemoryFallbackAllowed } from '@proctira/database';

import type { GradebookRepository } from './gradebook-repository.js';
import { InMemoryGradebookRepository } from './in-memory-repository.js';
import { createPgGradebookRepository, isPgGradebookEnabled } from './pg-gradebook-repository.js';

export function createGradebookRepository(): GradebookRepository {
  if (isPgGradebookEnabled()) {
    const pg = createPgGradebookRepository();
    if (pg) return pg;
  }
  assertInMemoryFallbackAllowed('gradebook');
  return new InMemoryGradebookRepository();
}
