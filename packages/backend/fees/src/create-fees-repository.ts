/**
 * Fees repository factory — Postgres when DATABASE_URL is set, else shared in-memory.
 * Shared in-memory ensures library fines (G-603) and /fees reads see the same ledger
 * within a single process when not using Postgres.
 */
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';
import type { FeesRepository } from './fees-repository.js';

let sharedMemoryFees: InMemoryFeesRepository | null = null;

export function isPgFeesEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

/** Test helper — clear shared in-memory fees store. */
export function resetSharedFeesRepositoryForTests(): void {
  sharedMemoryFees = null;
}

export function createFeesRepository(): FeesRepository {
  if (isPgFeesEnabled()) {
    const pool = getSharedFeesPool();
    if (pool) return new PgFeesRepository(pool);
  }
  if (!sharedMemoryFees) {
    sharedMemoryFees = new InMemoryFeesRepository();
  }
  return sharedMemoryFees;
}
