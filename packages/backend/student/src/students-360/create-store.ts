/**
 * Students 360 store composition (G-914).
 *
 *   - `DATABASE_URL` set → {@link PgStudents360Store} (raw pg + RLS)
 *   - otherwise          → {@link InMemoryStudents360Store} (dev / tests)
 */
import { assertInMemoryFallbackAllowed, getSharedPgPool } from '@proctira/database';

import { InMemoryStudents360Store, PgStudents360Store, type Students360Store } from './store.js';

export interface Students360StoreConfig {
  databaseUrl?: string;
}

export function createStudents360Store(config: Students360StoreConfig = {}): Students360Store {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    assertInMemoryFallbackAllowed('student.students360');
    return new InMemoryStudents360Store();
  }
  const pool = getSharedPgPool(databaseUrl);
  if (!pool) {
    assertInMemoryFallbackAllowed('student.students360');
    return new InMemoryStudents360Store();
  }
  return new PgStudents360Store(pool);
}
