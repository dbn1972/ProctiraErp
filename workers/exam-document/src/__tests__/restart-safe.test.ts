/**
 * Restart-safe integration proof for the exam-document worker spine (P0-06).
 *
 * Simulates a consumer crash mid-processing using InMemoryDurableQueueStore,
 * then restarts the worker against the same durable store and asserts the job
 * completes after redelivery.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DocumentGenerationService,
  InMemoryDocumentRepository,
  InMemoryExaminationRepository,
  QueueDocumentTaskQueue,
  SimplePdfGenerator,
  type DocumentCandidate,
  type ExaminationEntity,
} from '@proctira/backend-examination';
import {
  EXAM_DOCUMENT_CONSUME_TOPIC,
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
} from '@proctira/queue-abstraction';

import { createExamDocumentWorker } from '../worker.js';

const tenantId = 'tenant-spine';

function createExam(): Omit<ExaminationEntity, 'createdAt' | 'updatedAt'> {
  const start = new Date();
  start.setDate(start.getDate() + 30);
  const end = new Date(start);
  end.setDate(end.getDate() + 3);
  return {
    id: 'exam-spine',
    tenantId,
    name: 'Spine Exam',
    code: 'SPINE-1',
    description: 'P0-06 proof',
    academicPeriodId: 'period-1',
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    status: 'SCHEDULED',
    subjects: [
      {
        id: 'sub-1',
        examinationId: 'exam-spine',
        name: 'Math',
        code: 'M',
        maxScore: 100,
      },
    ],
    centers: [
      {
        id: 'center-1',
        examinationId: 'exam-spine',
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
        examinationId: 'exam-spine',
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

async function waitUntil(pred: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('exam-document worker restart-safe spine', () => {
  let store: InMemoryDurableQueueStore;
  let examRepo: InMemoryExaminationRepository;
  let docRepo: InMemoryDocumentRepository;

  beforeEach(async () => {
    store = new InMemoryDurableQueueStore();
    examRepo = new InMemoryExaminationRepository();
    docRepo = new InMemoryDocumentRepository();
    await examRepo.create(createExam());
    docRepo.seedCandidates('exam-spine', createCandidates(3));
  });

  it('redelivers and completes a job after consumer crash before ack', async () => {
    const publishAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await publishAdapter.connect();
    const taskQueue = new QueueDocumentTaskQueue(publishAdapter);

    const service = new DocumentGenerationService(
      examRepo,
      docRepo,
      new SimplePdfGenerator(),
      taskQueue,
    );

    const job = await service.requestGeneration(tenantId, 'exam-spine', {
      documentType: 'admit_card',
    });
    expect(job.status).toBe('queued');
    expect(store.pendingCount).toBe(1);

    let hangResolve!: () => void;
    const hang = new Promise<void>((r) => {
      hangResolve = r;
    });
    let firstAttempts = 0;

    const crashAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const crashWorker = createExamDocumentWorker({
      queue: crashAdapter,
      topic: EXAM_DOCUMENT_CONSUME_TOPIC,
      processor: {
        processJob: async () => {
          firstAttempts += 1;
          await hang;
        },
      },
    });
    await crashWorker.start();
    await waitUntil(() => store.inFlightCount === 1);
    expect(firstAttempts).toBe(1);

    await crashWorker.stop();
    expect(store.pendingCount).toBe(1);
    expect(store.inFlightCount).toBe(0);

    const resumeAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const resumeService = new DocumentGenerationService(
      examRepo,
      docRepo,
      new SimplePdfGenerator(),
    );
    const resumeWorker = createExamDocumentWorker({
      queue: resumeAdapter,
      topic: EXAM_DOCUMENT_CONSUME_TOPIC,
      processor: resumeService,
    });
    await resumeWorker.start();

    await waitUntil(async () => {
      const status = await resumeService.getJobStatus(tenantId, job.id);
      return status.status === 'completed';
    });

    const finalJob = await resumeService.getJobStatus(tenantId, job.id);
    expect(finalJob.status).toBe('completed');
    expect(finalJob.processedCount).toBe(3);
    expect(store.pendingCount).toBe(0);

    hangResolve();
    await resumeWorker.stop();
    await publishAdapter.disconnect();
  });
});
