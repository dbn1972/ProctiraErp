/**
 * PRC-H095: lifecycle certificate repository composition.
 *
 *   - `DATABASE_URL` set → {@link PgLifecycleCertificateRepository} (raw pg + RLS)
 *   - otherwise          → in-memory (dev / tests only; fail-closed in prod)
 */
import { assertInMemoryFallbackAllowed, getSharedPgPool } from '@proctira/database';

import { InMemoryLifecycleCertificateRepository } from './in-memory-repository.js';
import { PgLifecycleCertificateRepository } from './pg-repository.js';
import type { LifecycleCertificateRepository } from './types.js';

export interface LifecycleCertificateRepositoryConfig {
  databaseUrl?: string;
}

export function createLifecycleCertificateRepository(
  config: LifecycleCertificateRepositoryConfig = {},
): LifecycleCertificateRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    assertInMemoryFallbackAllowed('student.certificates');
    return new InMemoryLifecycleCertificateRepository();
  }
  const pool = getSharedPgPool(databaseUrl);
  if (!pool) {
    assertInMemoryFallbackAllowed('student.certificates');
    return new InMemoryLifecycleCertificateRepository();
  }
  return new PgLifecycleCertificateRepository(pool);
}
