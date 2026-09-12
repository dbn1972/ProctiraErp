/**
 * Parent portal repository factory — Postgres when DATABASE_URL is set, else in-memory.
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
} from '@proctira/database';

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

let sharedMemoryParent: InMemoryParentPortalRepository | null = null;

export function createParentPortalRepository(): ParentPortalRepository {
  if (isPgParentPortalEnabled()) {
    const pool = getSharedParentPortalPool();
    assertPostgresRepositoryAvailable('parent-portal', pool);
    return new PgParentPortalRepository(pool);
  }
  assertInMemoryFallbackAllowed('parent-portal');
  if (!sharedMemoryParent) {
    sharedMemoryParent = new InMemoryParentPortalRepository();
  }
  return sharedMemoryParent;
}

export function createAcademicVisibilityStore(): AcademicVisibilityStore {
  if (isPgParentPortalEnabled()) {
    const pool = getSharedParentPortalPool();
    assertPostgresRepositoryAvailable('parent-portal.academic-visibility', pool);
    return new PgAcademicVisibilityStore(pool);
  }
  assertInMemoryFallbackAllowed('parent-portal.academic-visibility');
  return new EmptyAcademicVisibilityStore();
}
