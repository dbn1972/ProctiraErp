/**
 * Dashboard repository factory — W1-SEC-12 / P0-05.
 *
 * Durable Postgres / warehouse-backed dashboard aggregates are not shipped yet.
 * When DATABASE_URL is set we fail closed (no silent in-memory, no fake Pg).
 * Otherwise assertInMemoryFallbackAllowed then return a shared in-memory store
 * (dev/unit only; never production).
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

import type { DashboardRepository } from './dashboard-repository.js';
import { InMemoryDashboardRepository } from './in-memory-repository.js';

let sharedMemory: InMemoryDashboardRepository | null = null;

/** True when operators configured Postgres (durable path required). */
export function isPgDashboardEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

/** Test helper — clear shared in-memory dashboard store. */
export function resetSharedDashboardRepositoryForTests(): void {
  sharedMemory = null;
}

/**
 * Resolve the dashboard repository for gateway mounts.
 *
 * - DATABASE_URL set → refuse (no durable dashboard schema yet; honesty over fake Pg)
 * - else → in-memory after {@link assertInMemoryFallbackAllowed}
 */
export function createDashboardRepository(): DashboardRepository {
  if (isPgDashboardEnabled()) {
    // No durable dashboard aggregate tables yet — refuse silent memory.
    assertPostgresRepositoryAvailable('dashboards', null);
  }
  assertInMemoryFallbackAllowed('dashboards');
  if (!sharedMemory) {
    sharedMemory = new InMemoryDashboardRepository();
  }
  return sharedMemory;
}
