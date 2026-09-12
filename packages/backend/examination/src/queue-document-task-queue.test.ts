import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EXAM_DOCUMENT_JOB_TYPE,
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  buildTenantName,
} from '@proctira/queue-abstraction';

import { QueueDocumentTaskQueue } from './queue-document-task-queue.js';
import type { DocumentGenerationJob } from './document-repository.js';

describe('QueueDocumentTaskQueue', () => {
  let store: InMemoryDurableQueueStore;
  let adapter: InMemoryDurableQueueAdapter;

  beforeEach(async () => {
    store = new InMemoryDurableQueueStore();
    adapter = new InMemoryDurableQueueAdapter({ store });
    await adapter.connect();
  });

  afterEach(async () => {
    if (adapter.isConnected()) await adapter.disconnect();
  });

  it('dispatches exam.document.generate with job payload', async () => {
    const queue = new QueueDocumentTaskQueue(adapter);
    const job: DocumentGenerationJob = {
      id: 'job-abc',
      tenantId: 't1',
      examinationId: 'exam-1',
      documentType: 'admit_card',
      status: 'queued',
      candidateIds: ['c1'],
      totalCandidates: 1,
      processedCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    };

    await queue.publishDocumentTask(job);

    expect(store.pendingCount).toBe(1);
    const entry = store.pending[0]!;
    expect(entry.routingKey).toBe(buildTenantName('t1', EXAM_DOCUMENT_JOB_TYPE));
    expect(entry.message.type).toBe(EXAM_DOCUMENT_JOB_TYPE);
    expect(entry.message.payload).toEqual({
      jobId: 'job-abc',
      examinationId: 'exam-1',
      documentType: 'admit_card',
    });
  });
});
