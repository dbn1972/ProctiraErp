/**
 * PRC-H092: large (>1000 rows) / async student imports are consumed.
 * - Durable queue configured: studentPlugin starts the import worker
 *   (onReady/onClose) and a 1,200-row import reaches `completed`.
 * - No durable queue: the in-process fallback processes the job.
 */
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
} from '@proctira/queue-abstraction';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryStudentRepository } from '../in-memory-repository.js';
import { studentPlugin } from '../student-plugin.js';

import { createExcelWorkbook } from './excel-parser.js';
import { QueueImportQueue } from './queue-import-queue.js';
import type { ImportProgress } from './types.js';

const TENANT_ID = '55555555-5555-4555-8555-555555555555';

async function buildWorkbook(rowCount: number): Promise<Buffer> {
  const workbook = await createExcelWorkbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow(['first_name', 'last_name', 'date_of_birth', 'national_id']);
  for (let i = 0; i < rowCount; i += 1) {
    sheet.addRow([`First${i}`, `Last${i}`, '2010-01-15', `NID-${i}`]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildApp(durable: boolean) {
  const store = new InMemoryDurableQueueStore();
  const publisherQueue = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
  await publisherQueue.connect();
  const repository = new InMemoryStudentRepository();
  const app = Fastify();
  await app.register(studentPlugin, {
    repository,
    prefix: '/students',
    importQueue: durable ? new QueueImportQueue(publisherQueue) : undefined,
    importWorkerQueue: durable
      ? new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 })
      : undefined,
  });
  app.addHook('onClose', async () => {
    await publisherQueue.disconnect();
  });
  await app.ready();
  return { app, store, repository };
}

async function waitForTerminal(app: FastifyInstance, jobId: string, timeoutMs = 20000) {
  const started = Date.now();
  for (;;) {
    const progress = await app.studentImportService!.getImportProgress(jobId);
    if (
      (progress && (progress.status === 'completed' || progress.status === 'failed')) ||
      Date.now() - started > timeoutMs
    ) {
      return progress;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('PRC-H092 student import consumer wiring', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('durable queue: 1,200-row import is consumed and students exist', async () => {
    const built = await buildApp(true);
    app = built.app;
    expect(app.studentImportWorker?.running).toBe(true);
    const queued = (await app.studentImportService!.processImport(
      TENANT_ID,
      await buildWorkbook(1200),
      { duplicateResolution: 'skip' },
    )) as ImportProgress;
    expect(queued.status).toBe('queued');
    const done = await waitForTerminal(app, queued.jobId);
    expect(done?.status).toBe('completed');
    const page = await built.repository.list(TENANT_ID, {}, { page: 1, pageSize: 1 });
    expect(page.meta.totalItems).toBe(1200);
    expect(built.store.pendingCount).toBe(0);
  }, 30000);

  it('no durable queue: async import is processed in-process', async () => {
    const built = await buildApp(false);
    app = built.app;
    expect(app.studentImportWorker).toBeUndefined();
    const queued = (await app.studentImportService!.processImport(
      TENANT_ID,
      await buildWorkbook(3),
      { duplicateResolution: 'skip', async: true },
    )) as ImportProgress;
    expect(queued.status).toBe('queued');
    const done = await waitForTerminal(app, queued.jobId, 5000);
    expect(done?.status).toBe('completed');
  });

  it('stops the import worker on close', async () => {
    const built = await buildApp(true);
    const worker = built.app.studentImportWorker!;
    await built.app.close();
    expect(worker.running).toBe(false);
  });
});
