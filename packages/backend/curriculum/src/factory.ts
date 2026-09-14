import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
} from '@proctira/database';
import type pg from 'pg';

import { InMemoryCurriculumStore, PgCurriculumStore, type CurriculumStore } from './store.js';

export function isPgCurriculumEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getSharedCurriculumPool(): pg.Pool | null {
  return getSharedPgPool();
}

export function createCurriculumStore(): CurriculumStore {
  if (isPgCurriculumEnabled()) {
    const pool = getSharedCurriculumPool();
    assertPostgresRepositoryAvailable('curriculum', pool);
    return new PgCurriculumStore(pool);
  }
  assertInMemoryFallbackAllowed('curriculum');
  return new InMemoryCurriculumStore();
}
