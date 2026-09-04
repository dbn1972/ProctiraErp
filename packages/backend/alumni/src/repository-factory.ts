import { createPrismaClient } from '@proctira/database';
import { InMemoryAlumniRepository } from './in-memory-repository.js';
import { PrismaAlumniRepository } from './prisma-alumni-repository.js';
import type { AlumniRepository } from './alumni-repository.js';

export interface AlumniRepositoryConfig {
  databaseUrl?: string;
}

export function createAlumniRepository(config: AlumniRepositoryConfig = {}): AlumniRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return new InMemoryAlumniRepository();
  return new PrismaAlumniRepository(createPrismaClient({ datasourceUrl: databaseUrl }));
}
