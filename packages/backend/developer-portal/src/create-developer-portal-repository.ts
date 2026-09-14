/**
 * Developer portal repository factory — Postgres API keys when DATABASE_URL is set.
 */
import { assertInMemoryFallbackAllowed } from '@proctira/database';

import { HybridDeveloperPortalRepository } from './hybrid-repository.js';
import { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';
import type { DeveloperPortalExtendedRepository } from './developer-portal-repository.js';
import {
  ensureDeveloperPortalApiKeySchema,
  getSharedDeveloperPortalPool,
  PgApiKeyStore,
} from './pg-api-key-store.js';

export function isPgDeveloperPortalApiKeysEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

let schemaEnsured = false;
let sharedMemory: InMemoryDeveloperPortalRepository | null = null;

export async function ensureDeveloperPortalPersistence(): Promise<void> {
  if (!isPgDeveloperPortalApiKeysEnabled() || schemaEnsured) return;
  const pool = getSharedDeveloperPortalPool();
  if (!pool) return;
  await ensureDeveloperPortalApiKeySchema(pool);
  schemaEnsured = true;
}

export function createDeveloperPortalRepository(): DeveloperPortalExtendedRepository {
  if (isPgDeveloperPortalApiKeysEnabled()) {
    const pool = getSharedDeveloperPortalPool();
    if (pool) {
      return new HybridDeveloperPortalRepository(new PgApiKeyStore(pool));
    }
  }
  assertInMemoryFallbackAllowed('developer-portal');
  if (!sharedMemory) {
    sharedMemory = new InMemoryDeveloperPortalRepository();
  }
  return sharedMemory;
}
