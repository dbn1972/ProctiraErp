/**
 * Privacy repository factory — Postgres when DATABASE_URL is set, else shared in-memory.
 * P0-05 / W1-SEC-12: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import { getSharedPrivacyPool, PgPrivacyRepository } from './pg-privacy-repository.js';
import type { PrivacyRepository, PrivacyTxnAuditPort } from './privacy-repository.js';
import { getSharedInMemoryPrivacyRepository } from './shared-store.js';

export function isPgPrivacyEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export interface CreatePrivacyRepositoryOptions {
  /**
   * PRC-M013: when set (Postgres path only), erasure state-transition audit rows
   * are written in the same transaction as the transition. The in-memory
   * fallback keeps the post-hoc audit path.
   */
  txnAuditPort?: PrivacyTxnAuditPort;
}

export function createPrivacyRepository(
  options: CreatePrivacyRepositoryOptions = {},
): PrivacyRepository {
  if (isPgPrivacyEnabled()) {
    const pool = getSharedPrivacyPool();
    assertPostgresRepositoryAvailable('privacy', pool);
    return new PgPrivacyRepository(pool, options.txnAuditPort);
  }
  assertInMemoryFallbackAllowed('privacy');
  return getSharedInMemoryPrivacyRepository();
}
