import { getSharedPgPool } from '@proctira/database';

import type { EnrollmentRepository } from '../enrollment/enrollment-repository.js';

import { MemoryTransferWorkflowStore } from './memory-store.js';
import { PgTransferWorkflowStore } from './pg-store.js';
import { TransferWorkflowService } from './service.js';

export function createTransferWorkflow(enrollment: EnrollmentRepository): TransferWorkflowService {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl && databaseUrl.trim().length > 0) {
    const pool = getSharedPgPool(databaseUrl);
    if (pool) return new TransferWorkflowService(new PgTransferWorkflowStore(pool));
  }
  return new TransferWorkflowService(new MemoryTransferWorkflowStore(enrollment));
}
