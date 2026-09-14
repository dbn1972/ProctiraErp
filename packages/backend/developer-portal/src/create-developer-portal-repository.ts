/**
 * Developer portal repository factory — Postgres durable state when DATABASE_URL
 * is set (API keys + accounts/webhooks/deliveries). Production refuses memory.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import { HybridDeveloperPortalRepository } from './hybrid-repository.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import type { DeveloperPortalExtendedRepository } from './developer-portal-repository.js';
import * as apiKeyStore from './pg-api-key-store.js';
import * as durableStore from './pg-durable-store.js';

/** True when Postgres-backed developer-portal durable state should be used. */
export function isPgDeveloperPortalEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

/** @deprecated Prefer {@link isPgDeveloperPortalEnabled} (W1-ARCH-01 COMPLETE). */
export function isPgDeveloperPortalApiKeysEnabled(): boolean {
  return isPgDeveloperPortalEnabled();
}

let schemaEnsured = false;
let sharedMemory: InMemoryDeveloperPortalRepository | null = null;

export async function ensureDeveloperPortalPersistence(): Promise<void> {
  if (!isPgDeveloperPortalEnabled() || schemaEnsured) return;
  const pool = apiKeyStore.getSharedDeveloperPortalPool();
  assertPostgresRepositoryAvailable('developer-portal', pool);
  await apiKeyStore.ensureDeveloperPortalApiKeySchema(pool);
  await durableStore.ensureDeveloperPortalDurableSchema(pool);
  schemaEnsured = true;
}

/** Test helper — clear shared memory + schema memo. */
export function resetDeveloperPortalRepositoryForTests(): void {
  sharedMemory = null;
  schemaEnsured = false;
}

export function createDeveloperPortalRepository(): DeveloperPortalExtendedRepository {
  if (isPgDeveloperPortalEnabled()) {
    const pool = apiKeyStore.getSharedDeveloperPortalPool();
    assertPostgresRepositoryAvailable('developer-portal', pool);
    return new HybridDeveloperPortalRepository(
      new apiKeyStore.PgApiKeyStore(pool),
      new durableStore.PgDeveloperPortalDurableStore(pool),
    );
  }
  assertInMemoryFallbackAllowed('developer-portal');
  if (!sharedMemory) {
    sharedMemory = new InMemoryDeveloperPortalRepository();
  }
  return sharedMemory;
}
