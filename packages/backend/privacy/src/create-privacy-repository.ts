/**
 * Privacy repository factory — Postgres when DATABASE_URL is set, else shared in-memory.
 * P0-05 / W1-SEC-12: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import type { PrivacyRepository } from './privacy-repository.js';
import { getSharedPrivacyPool, PgPrivacyRepository } from './pg-privacy-repository.js';
import { getSharedInMemoryPrivacyRepository } from './shared-store.js';

export function isPgPrivacyEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createPrivacyRepository(): PrivacyRepository {
  if (isPgPrivacyEnabled()) {
    const pool = getSharedPrivacyPool();
    assertPostgresRepositoryAvailable('privacy', pool);
    return new PgPrivacyRepository(pool);
  }
  assertInMemoryFallbackAllowed('privacy');
  return getSharedInMemoryPrivacyRepository();
}
