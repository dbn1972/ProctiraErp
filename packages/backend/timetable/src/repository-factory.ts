import { createPrismaClient } from '@proctira/database';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { PrismaTimetableRepository } from './prisma-timetable-repository.js';
import type { TimetableRepository } from './timetable-repository.js';

export interface TimetableRepositoryConfig {
  databaseUrl?: string;
}

export function createTimetableRepository(config: TimetableRepositoryConfig = {}): TimetableRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return new InMemoryTimetableRepository();
  return new PrismaTimetableRepository(createPrismaClient({ datasourceUrl: databaseUrl }));
}
