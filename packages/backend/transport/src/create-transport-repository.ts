/**
 * Transport repository factory — Postgres when DATABASE_URL is set, else in-memory.
 */
import { InMemoryTransportRepository } from './in-memory-repository.js';
import { getSharedTransportPool, PgTransportRepository } from './pg-transport-repository.js';
import type { TransportRepository } from './transport-repository.js';

export function isPgTransportEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createTransportRepository(): TransportRepository {
  if (isPgTransportEnabled()) {
    const pool = getSharedTransportPool();
    if (pool) return new PgTransportRepository(pool);
  }
  return new InMemoryTransportRepository();
}
