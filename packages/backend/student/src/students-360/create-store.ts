/**
 * Students 360 store composition (G-914).
 *
 *   - `DATABASE_URL` set → {@link PgStudents360Store} (raw pg + RLS)
 *   - otherwise          → {@link InMemoryStudents360Store} (dev / tests)
 */
import { assertInMemoryFallbackAllowed } from '@proctira/database';
import pg from 'pg';

import { InMemoryStudents360Store, PgStudents360Store, type Students360Store } from './store.js';

const { Pool } = pg;

let sharedPool: pg.Pool | null = null;

export interface Students360StoreConfig {
  databaseUrl?: string;
}

export function createStudents360Store(config: Students360StoreConfig = {}): Students360Store {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    assertInMemoryFallbackAllowed('student.students360');
    return new InMemoryStudents360Store();
  }
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: databaseUrl });
  }
  return new PgStudents360Store(sharedPool);
}
