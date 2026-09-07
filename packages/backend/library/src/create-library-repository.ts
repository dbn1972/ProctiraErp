/**
 * Library repository factory — Postgres when DATABASE_URL is set, else in-memory.
 */
import { InMemoryLibraryRepository } from './in-memory-repository.js';
import type { LibraryRepository } from './library-repository.js';
import { getSharedLibraryPool, PgLibraryRepository } from './pg-library-repository.js';

export function isPgLibraryEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createLibraryRepository(): LibraryRepository {
  if (isPgLibraryEnabled()) {
    const pool = getSharedLibraryPool();
    if (pool) return new PgLibraryRepository(pool);
  }
  return new InMemoryLibraryRepository();
}
