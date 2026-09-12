import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';
import pg from 'pg';

import { InMemoryCurriculumStore, PgCurriculumStore, type CurriculumStore } from './store.js';

const { Pool } = pg;

let sharedPool: pg.Pool | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function isPgCurriculumEnabled(): boolean {
  return resolveDatabaseUrl() !== null;
}

export function getSharedCurriculumPool(): pg.Pool | null {
  const url = resolveDatabaseUrl();
  if (!url) return null;
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: url });
  }
  return sharedPool;
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
