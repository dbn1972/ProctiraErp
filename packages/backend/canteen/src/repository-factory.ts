import { createPrismaClient } from '@proctira/database';
import { InMemoryCanteenRepository } from './in-memory-repository.js';
import { PrismaCanteenRepository } from './prisma-canteen-repository.js';
import type { CanteenRepository } from './canteen-repository.js';

export interface CanteenRepositoryConfig {
  databaseUrl?: string;
}

export function createCanteenRepository(config: CanteenRepositoryConfig = {}): CanteenRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return new InMemoryCanteenRepository();
  return new PrismaCanteenRepository(createPrismaClient({ datasourceUrl: databaseUrl }));
}
