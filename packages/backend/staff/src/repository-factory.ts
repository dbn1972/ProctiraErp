/**
 * Staff repository composition.
 *
 *   - `DATABASE_URL` set → PrismaStaffRepository (Postgres + RLS)
 *   - otherwise          → InMemoryStaffRepository (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';

import { InMemoryStaffRepository } from './in-memory-repository.js';
import { PrismaStaffRepository } from './prisma-staff-repository.js';
import type { StaffRepository } from './staff-repository.js';

export interface StaffRepositoryConfig {
  databaseUrl?: string;
}

export function createStaffRepository(
  config: StaffRepositoryConfig = {},
): StaffRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryStaffRepository();
  }
  return new PrismaStaffRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}
