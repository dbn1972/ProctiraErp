/**
 * Transport repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaTransportRepository} (Postgres + RLS)
 *   - otherwise          → {@link InMemoryTransportRepository} (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';

import { InMemoryTransportRepository } from './in-memory-repository.js';
import { PrismaTransportRepository } from './prisma-transport-repository.js';
import type { TransportRepository } from './transport-repository.js';

export interface TransportRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
}

export function createTransportRepository(
  config: TransportRepositoryConfig = {},
): TransportRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryTransportRepository();
  }
  return new PrismaTransportRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}
