/**
 * Import repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaImportStudentRepository}
 *   - otherwise          → {@link InMemoryStudentRepository} (dev / tests)
 */
import { createPrismaClient, getPrismaClient } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import { InMemoryStudentRepository } from './in-memory-student-repository.js';
import { PrismaImportStudentRepository } from './prisma-import-student-repository.js';
import type { StudentRepository } from './types.js';

export interface ImportStudentRepositoryConfig {
  databaseUrl?: string;
  prisma?: PrismaClient;
}

export function createImportStudentRepository(
  config: ImportStudentRepositoryConfig = {},
): StudentRepository {
  const prisma =
    config.prisma ??
    (config.databaseUrl
      ? createPrismaClient({ datasourceUrl: config.databaseUrl })
      : process.env['DATABASE_URL']
        ? getPrismaClient()
        : undefined);

  if (!prisma) {
    return new InMemoryStudentRepository();
  }

  return new PrismaImportStudentRepository(prisma);
}
