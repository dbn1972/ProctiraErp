/**
 * W2-JOB-06: student bulk import queue durability across process restart.
 *
 * Simulates a consumer crash mid-processQueuedImport using InMemoryDurableQueueStore,
 * then restarts the worker against the same durable store and asserts the import
 * completes after redelivery.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  STUDENT_IMPORT_CONSUME_TOPIC,
} from '@proctira/queue-abstraction';

import { ImportService } from './import-service.js';
import { InMemoryStudentRepository } from './in-memory-student-repository.js';
import { QueueImportQueue } from './queue-import-queue.js';
import { createStudentImportWorker } from './student-import-worker.js';
import type { ImportOptions } from './types.js';

const TENANT_ID = 'tenant-import-spine';

async function waitUntil(pred: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** Minimal xlsx-like CSV isn't enough — use a tiny valid buffer via exceljs path in parser.
 *  For durability we only need enqueue→crash→redeliver; processor can be stubbed. */
describe('W2-JOB-06 student import queue durability', () => {
  let store: InMemoryDurableQueueStore;

  beforeEach(() => {
    store = new InMemoryDurableQueueStore();
  });

  it('redelivers and completes after consumer crash before ack', async () => {
    const publishAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await publishAdapter.connect();
    const importQueue = new QueueImportQueue(publishAdapter);

    const options: ImportOptions = { duplicateResolution: 'skip', async: true };
    const jobId = 'job-import-1';
    const fileBuffer = Buffer.from('fake-excel-bytes');

    await importQueue.updateProgress(jobId, {
      jobId,
      status: 'queued',
      totalRows: 1,
      processedRows: 0,
      progressPercent: 0,
      startedAt: new Date().toISOString(),
    });
    await importQueue.enqueue(TENANT_ID, jobId, fileBuffer, options);

    expect(store.pendingCount).toBeGreaterThanOrEqual(1);

    let hangResolve!: () => void;
    const hang = new Promise<void>((r) => {
      hangResolve = r;
    });
    let firstAttempts = 0;
    let completed = false;

    const crashAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const crashWorker = createStudentImportWorker({
      queue: crashAdapter,
      processor: {
        processQueuedImport: async () => {
          firstAttempts += 1;
          await hang;
          return { totalRows: 0, successCount: 0, errorCount: 0, duplicateCount: 0, errors: [], duplicates: [] };
        },
      },
    });
    await crashWorker.start();
    await waitUntil(() => store.inFlightCount === 1);
    expect(firstAttempts).toBe(1);

    await crashWorker.stop();
    expect(store.pendingCount).toBeGreaterThanOrEqual(1);
    expect(store.inFlightCount).toBe(0);

    const resumeAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const resumeWorker = createStudentImportWorker({
      queue: resumeAdapter,
      topic: STUDENT_IMPORT_CONSUME_TOPIC,
      processor: {
        processQueuedImport: async (tenantId, id) => {
          expect(tenantId).toBe(TENANT_ID);
          expect(id).toBe(jobId);
          completed = true;
          return {
            totalRows: 1,
            successCount: 1,
            errorCount: 0,
            duplicateCount: 0,
            errors: [],
            duplicates: [],
          };
        },
      },
    });
    await resumeWorker.start();
    await waitUntil(() => completed);
    await resumeWorker.stop();

    hangResolve();
    expect(completed).toBe(true);
    expect(store.pendingCount).toBe(0);
  });

  it('ImportService.processQueuedImport updates progress via durable queue wrapper', async () => {
    const adapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await adapter.connect();
    const importQueue = new QueueImportQueue(adapter);
    const repo = new InMemoryStudentRepository();
    const service = new ImportService({ studentRepository: repo, importQueue });

    // Use dry-run with empty/invalid excel — parseExcelBuffer will fail headers.
    // That still exercises progress transitions without needing a real xlsx.
    const jobId = 'job-progress-1';
    const result = await service.processQueuedImport(
      TENANT_ID,
      jobId,
      Buffer.from('not-an-excel'),
      { duplicateResolution: 'skip' },
    );
    expect(result.errorCount).toBeGreaterThan(0);
    const progress = await importQueue.getProgress(jobId);
    expect(progress?.status).toBe('failed');
  });
});
