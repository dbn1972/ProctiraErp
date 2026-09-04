import { createPrismaClient } from '@proctira/database';
import { InMemoryPayrollRepository } from './in-memory-repository.js';
import { PrismaPayrollRepository } from './prisma-payroll-repository.js';
import type { PayrollRepository } from './payroll-repository.js';

export interface PayrollRepositoryConfig {
  databaseUrl?: string;
}

export function createPayrollRepository(config: PayrollRepositoryConfig = {}): PayrollRepository {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return new InMemoryPayrollRepository();
  return new PrismaPayrollRepository(createPrismaClient({ datasourceUrl: databaseUrl }));
}
