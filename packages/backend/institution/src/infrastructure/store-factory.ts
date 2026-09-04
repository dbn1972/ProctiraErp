/**
 * Infrastructure store composition.
 *
 *   - `DATABASE_URL` set → Prisma stores (Postgres + RLS)
 *   - otherwise          → in-memory stores (dev / tests)
 */
import { createPrismaClient, getPrismaClient } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import { InMemoryConditionOptionStore, InMemoryInfrastructureStore } from './in-memory-store.js';
import { PrismaConditionOptionStore, PrismaInfrastructureStore } from './prisma-store.js';
import type { ConditionOptionStore, InfrastructureStore } from './service.js';

export interface InfrastructureStoreConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
  /** Explicit Prisma client (tests / custom wiring). */
  prisma?: PrismaClient;
}

export interface InfrastructureStores {
  store: InfrastructureStore;
  conditionStore: ConditionOptionStore;
}

/**
 * Builds infrastructure + condition stores for the current configuration.
 */
export function createInfrastructureStores(
  config: InfrastructureStoreConfig = {},
): InfrastructureStores {
  const prisma =
    config.prisma ??
    (config.databaseUrl
      ? createPrismaClient({ datasourceUrl: config.databaseUrl })
      : process.env['DATABASE_URL']
        ? getPrismaClient()
        : undefined);

  if (!prisma) {
    return {
      store: new InMemoryInfrastructureStore(),
      conditionStore: new InMemoryConditionOptionStore(),
    };
  }

  return {
    store: new PrismaInfrastructureStore(prisma),
    conditionStore: new PrismaConditionOptionStore(prisma),
  };
}
