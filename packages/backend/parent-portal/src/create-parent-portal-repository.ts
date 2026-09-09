/**
 * Parent portal repository factory — Postgres when DATABASE_URL is set, else in-memory.
 */
import { assertInMemoryFallbackAllowed } from '@proctira/database';

import {
  EmptyAcademicVisibilityStore,
  type AcademicVisibilityStore,
} from './academic-visibility.js';
import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import type { ParentPortalRepository } from './parent-portal-repository.js';
import { PgAcademicVisibilityStore } from './pg-academic-visibility-store.js';
import {
  getSharedParentPortalPool,
  PgParentPortalRepository,
} from './pg-parent-portal-repository.js';

export function isPgParentPortalEnabled(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && url.length > 0;
}

export function createParentPortalRepository(): ParentPortalRepository {
  if (isPgParentPortalEnabled()) {
    const pool = getSharedParentPortalPool();
    if (pool) return new PgParentPortalRepository(pool);
  }
  assertInMemoryFallbackAllowed('parent-portal');
  return new InMemoryParentPortalRepository();
}

export function createAcademicVisibilityStore(): AcademicVisibilityStore {
  if (isPgParentPortalEnabled()) {
    const pool = getSharedParentPortalPool();
    if (pool) return new PgAcademicVisibilityStore(pool);
  }
  return new EmptyAcademicVisibilityStore();
}
