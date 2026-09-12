import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import {
  InMemoryGradebookExtrasStore,
  PgGradebookExtrasStore,
  type GradebookExtrasStore,
} from './extras-store.js';
import { getSharedGradebookPool, isPgGradebookEnabled } from './pg-gradebook-repository.js';

export function createGradebookExtrasStore(): GradebookExtrasStore {
  if (isPgGradebookEnabled()) {
    const pool = getSharedGradebookPool();
    assertPostgresRepositoryAvailable('gradebook.extras', pool);
    return new PgGradebookExtrasStore(pool);
  }
  assertInMemoryFallbackAllowed('gradebook');
  return new InMemoryGradebookExtrasStore();
}
