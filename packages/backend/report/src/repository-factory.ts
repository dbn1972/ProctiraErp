/**
 * Report repository composition.
 *
 *   - `DATABASE_URL` set → {@link PrismaReportRepository} (Postgres + RLS)
 *   - otherwise          → {@link InMemoryReportRepository} (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';

import { InMemoryReportRepository } from './in-memory-repository.js';
import { PrismaReportRepository } from './prisma-report-repository.js';
import type { ReportRepository } from './report-repository.js';

export interface ReportRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
}

export function createReportRepository(
  config: ReportRepositoryConfig = {},
): ReportRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    return new InMemoryReportRepository();
  }
  return new PrismaReportRepository(
    createPrismaClient({ datasourceUrl: databaseUrl }),
  );
}
