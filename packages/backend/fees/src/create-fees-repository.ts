/**
 * Fees repository factory — Postgres when DATABASE_URL is set, else in-memory.
 */
import { InMemoryFeesRepository } from './in-memory-repository.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';
import type { FeesRepository } from './fees-repository.js';

export function isPgFeesEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createFeesRepository(): FeesRepository {
  if (isPgFeesEnabled()) {
    const pool = getSharedFeesPool();
    if (pool) return new PgFeesRepository(pool);
  }
  return new InMemoryFeesRepository();
}
