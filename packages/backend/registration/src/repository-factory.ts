/**
 * Registration repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaRegistrationRepository} (Postgres + RLS)
 *   - otherwise          → {@link InMemoryRegistrationRepository} (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';

import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { PrismaRegistrationRepository } from './prisma-registration-repository.js';
import type { RegistrationRepository } from './registration-repository.js';

export interface RegistrationRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
  /**
   * Tenant for public lookups that omit tenantId from the repository API
   * (tracking number, status, institution helpers). Defaults to
   * `process.env.DEFAULT_TENANT_ID`.
   */
  defaultTenantId?: string;
}

export function createRegistrationRepository(
  config: RegistrationRepositoryConfig = {},
): RegistrationRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryRegistrationRepository();
  }
  const defaultTenantId =
    config.defaultTenantId ?? process.env['DEFAULT_TENANT_ID'];
  return new PrismaRegistrationRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
    { defaultTenantId },
  );
}
