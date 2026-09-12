import {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  getSharedPgPool,
} from '@proctira/database';

import { PgReportStore } from './pg-report-store.js';
import { InMemoryReportStore, type ReportStore } from './report-store.js';

export type ReportPersistence = 'postgres' | 'memory';

let sharedMemory: InMemoryReportStore | null = null;

export function resetSharedReportStoreForTests(): void {
  sharedMemory = null;
}

export function createReportStore(): { store: ReportStore; persistence: ReportPersistence } {
  if (process.env.DATABASE_URL?.trim()) {
    const pool = getSharedPgPool();
    assertPostgresRepositoryAvailable('report', pool);
    return { store: new PgReportStore(pool), persistence: 'postgres' };
  }
  assertInMemoryFallbackAllowed('report');
  sharedMemory ??= new InMemoryReportStore();
  return { store: sharedMemory, persistence: 'memory' };
}
