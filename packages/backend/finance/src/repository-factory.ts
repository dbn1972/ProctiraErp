import { createPrismaClient } from '@proctira/database';
import { InMemoryFinanceRepository } from './in-memory-repository.js';
import { PrismaFinanceRepository } from './prisma-finance-repository.js';
import type { FinanceRepository } from './finance-repository.js';

export interface FinanceRepositoryConfig {
  databaseUrl?: string;
}

export function createFinanceRepository(config: FinanceRepositoryConfig = {}): FinanceRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return new InMemoryFinanceRepository();
  return new PrismaFinanceRepository(createPrismaClient({ datasourceUrl: databaseUrl }));
}
