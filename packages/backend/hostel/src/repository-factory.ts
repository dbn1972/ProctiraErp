import { createPrismaClient } from '@proctira/database';
import { InMemoryHostelRepository } from './in-memory-repository.js';
import { PrismaHostelRepository } from './prisma-hostel-repository.js';
import type { HostelRepository } from './hostel-repository.js';

export interface HostelRepositoryConfig {
  databaseUrl?: string;
}

export function createHostelRepository(config: HostelRepositoryConfig = {}): HostelRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return new InMemoryHostelRepository();
  return new PrismaHostelRepository(createPrismaClient({ datasourceUrl: databaseUrl }));
}
