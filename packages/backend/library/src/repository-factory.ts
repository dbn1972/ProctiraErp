import { createPrismaClient } from '@proctira/database';
import { InMemoryLibraryRepository } from './in-memory-repository.js';
import { PrismaLibraryRepository } from './prisma-library-repository.js';
import type { LibraryRepository } from './library-repository.js';

export interface LibraryRepositoryConfig {
  databaseUrl?: string;
}

export function createLibraryRepository(config: LibraryRepositoryConfig = {}): LibraryRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return new InMemoryLibraryRepository();
  return new PrismaLibraryRepository(createPrismaClient({ datasourceUrl: databaseUrl }));
}
