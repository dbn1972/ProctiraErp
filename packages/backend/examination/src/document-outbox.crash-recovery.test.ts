/**
 * W2-JOB-04: examination document generation uses transactional outbox.
 * Crash between commit and broker publish is recovered by OutboxRelay.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EXAM_DOCUMENT_JOB_TYPE,
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  InMemoryOutboxStore,
  OutboxRelay,
  buildTenantName,
} from '@proctira/queue-abstraction';

import { DocumentGenerationService } from './document-generation-service.js';
import { InMemoryDocumentRepository } from './in-memory-document-repository.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { SimplePdfGenerator } from './pdf-generator.js';
import { QueueDocumentTaskQueue } from './queue-document-task-queue.js';
import type { DocumentCandidate } from './document-repository.js';
import type { ExaminationEntity } from './examination-repository.js';

const tenantId = '22222222-2222-4222-8222-222222222222';

function createExam(): Omit<ExaminationEntity, 'createdAt' | 'updatedAt'> {
  const start = new Date();
  start.setDate(start.getDate() + 30);
  const end = new Date(start);
  end.setDate(end.getDate() + 3);
  return {
    id: 'exam-outbox',
    tenantId,
    name: 'Outbox Exam',
    code: 'OUT-1',
    description: 'W2-JOB-04',
    academicPeriodId: 'period-1',
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    status: 'SCHEDULED',
    subjects: [
      {
        id: 'sub-1',
        examinationId: 'exam-outbox',
        name: 'Math',
        code: 'M',
        maxScore: 100,
      },
    ],
    centers: [
      {
        id: 'center-1',
        examinationId: 'exam-outbox',
        name: 'Center',
        code: 'C1',
        institutionId: 'inst-1',
        capacity: 50,
      },
    ],
    sessions: [],
    gradingSchemes: [
      {
        id: 'gs-1',
        examinationId: 'exam-outbox',
        name: 'Default',
        minScore: 0,
        maxScore: 100,
        passThreshold: 50,
        thresholds: [{ grade: 'A', minScore: 50, maxScore: 100 }],
      },
    ],
  };
}

function createCandidates(n: number): DocumentCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `cand-${i}`,
    studentId: `stu-${i}`,
    studentName: `Student ${i}`,
    rollNumber: `R${i}`,
    centerId: 'center-1',
    centerName: 'Center',
    subjectIds: ['sub-1'],
    subjectNames: ['Math'],
    gender: 'other',
  }));
}

describe('W2-JOB-04 examination document outbox cutover', () => {
  let examinationRepository: InMemoryExaminationRepository;
  let documentRepository: InMemoryDocumentRepository;
  let durableStore: InMemoryDurableQueueStore;
  let queue: InMemoryDurableQueueAdapter;
  let outbox: InMemoryOutboxStore;

  beforeEach(async () => {
    examinationRepository = new InMemoryExaminationRepository();
    documentRepository = new InMemoryDocumentRepository();
    durableStore = new InMemoryDurableQueueStore();
    queue = new InMemoryDurableQueueAdapter({ store: durableStore, pollIntervalMs: 5 });
    await queue.connect();
    outbox = new InMemoryOutboxStore();

    await examinationRepository.create(createExam());
    documentRepository.seedCandidates('exam-outbox', createCandidates(3));
  });

  it('CONFIRMED tip dual-write: createJob then publish leaves orphan job on crash', async () => {
    const dualWriteQueue = {
      async publishDocumentTask() {
        throw new Error('crash after DB commit');
      },
    };
    const service = new DocumentGenerationService(
      examinationRepository,
      documentRepository,
      new SimplePdfGenerator(),
      dualWriteQueue,
    );

    await expect(
      service.requestGeneration(tenantId, 'exam-outbox', { documentType: 'admit_card' }),
    ).rejects.toThrow(/crash after DB commit/);

    const jobs = await documentRepository.listJobs('exam-outbox', tenantId);
    expect(jobs).toHaveLength(1);
    expect(durableStore.pendingCount).toBe(0);
  });

  it('outbox path: crash before relay still delivers via OutboxRelay', async () => {
    const service = new DocumentGenerationService(
      examinationRepository,
      documentRepository,
      new SimplePdfGenerator(),
      undefined,
      undefined,
      outbox,
    );

    const job = await service.requestGeneration(tenantId, 'exam-outbox', {
      documentType: 'admit_card',
    });

    // Committed: job + outbox. Broker empty (relay not run yet = crash window).
    expect(job.status).toBe('queued');
    expect(await outbox.listPending()).toHaveLength(1);
    expect(durableStore.pendingCount).toBe(0);

    const relay = new OutboxRelay({ store: outbox, queue });
    expect(await relay.tick()).toBe(1);

    expect(await outbox.listPending()).toHaveLength(0);
    expect(durableStore.pendingCount).toBe(1);

    const leased = durableStore.leaseMatching(
      buildTenantName(tenantId, EXAM_DOCUMENT_JOB_TYPE),
    );
    expect(leased?.message.payload).toMatchObject({
      jobId: job.id,
      examinationId: 'exam-outbox',
      documentType: 'admit_card',
    });
  });

  it('does not call QueueDocumentTaskQueue when outboxStore is set', async () => {
    let directPublishes = 0;
    const direct = new QueueDocumentTaskQueue(queue);
    const wrapped = {
      publishDocumentTask: async (job: Parameters<QueueDocumentTaskQueue['publishDocumentTask']>[0]) => {
        directPublishes += 1;
        await direct.publishDocumentTask(job);
      },
    };

    const service = new DocumentGenerationService(
      examinationRepository,
      documentRepository,
      new SimplePdfGenerator(),
      wrapped,
      undefined,
      outbox,
    );

    await service.requestGeneration(tenantId, 'exam-outbox', { documentType: 'admit_card' });
    expect(directPublishes).toBe(0);
    expect(durableStore.pendingCount).toBe(0);
    expect(await outbox.listPending()).toHaveLength(1);
  });
});
