import { createPrismaClient } from '@proctira/database';
import { InMemoryInventoryRepository } from './in-memory-repository.js';
import { PrismaInventoryRepository } from './prisma-inventory-repository.js';
import type { InventoryRepository } from './inventory-repository.js';

export interface InventoryRepositoryConfig {
  databaseUrl?: string;
}

export function createInventoryRepository(config: InventoryRepositoryConfig = {}): InventoryRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return new InMemoryInventoryRepository();
  return new PrismaInventoryRepository(createPrismaClient({ datasourceUrl: databaseUrl }));
}
