/**
 * Scholarship repository factory — Postgres when DATABASE_URL is set, else in-memory.
 */
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { getSharedScholarshipPool, PgScholarshipRepository } from './pg-scholarship-repository.js';
import type { ScholarshipRepository } from './scholarship-repository.js';

export function isPgScholarshipEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createScholarshipRepository(): ScholarshipRepository {
  if (isPgScholarshipEnabled()) {
    const pool = getSharedScholarshipPool();
    if (pool) return new PgScholarshipRepository(pool);
  }
  return new InMemoryScholarshipRepository();
}
