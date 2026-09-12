/**
 * Roles & Permissions repository factory (G-910): Postgres when DATABASE_URL
 * is set, else in-memory (refused in production by the persistence policy).
 * The caller passes the built-in role seed (`DEFAULT_ROLES` in the gateway)
 * so this package stays decoupled from `@proctira/auth`.
 * P0-05: never fall through to memory when DATABASE_URL is set.
 */
import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
} from '@proctira/database';

import { InMemoryRolesRepository, type BuiltInRoleSeed } from './in-memory-roles-repository.js';
import { PgRolesRepository } from './pg-roles-repository.js';
import type { RolesRepository } from './roles-repository.js';

export type RolesPersistence = 'postgres' | 'memory';

export function createRolesRepository(seed: BuiltInRoleSeed[] = []): {
  repository: RolesRepository;
  persistence: RolesPersistence;
} {
  if (process.env.DATABASE_URL?.trim()) {
    const pool = getSharedPgPool();
    assertPostgresRepositoryAvailable('tenant-roles', pool);
    return { repository: new PgRolesRepository(pool, seed), persistence: 'postgres' };
  }
  assertInMemoryFallbackAllowed('tenant-roles');
  return { repository: new InMemoryRolesRepository(seed), persistence: 'memory' };
}
