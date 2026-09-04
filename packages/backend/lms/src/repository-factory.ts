import { createPrismaClient } from '@proctira/database';
import { InMemoryLmsRepository } from './in-memory-repository.js';
import { PrismaLmsRepository } from './prisma-lms-repository.js';
import type { LmsRepository } from './lms-repository.js';

export interface LmsRepositoryConfig {
  databaseUrl?: string;
}

export function createLmsRepository(config: LmsRepositoryConfig = {}): LmsRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return new InMemoryLmsRepository();
  return new PrismaLmsRepository(createPrismaClient({ datasourceUrl: databaseUrl }));
}
