/**
 * Restart-safe proof for privacy anonymization durable worker (W1-SEC-06).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  PRIVACY_ANONYMIZATION_CONSUME_TOPIC,
} from '@proctira/queue-abstraction';

import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { RecordingPrivacyAuditPort } from './privacy-audit.js';
import { PrivacyService } from './privacy-service.js';
import { createPrivacyAnonymizationWorker } from './privacy-worker.js';
import { QueuePrivacyAnonymizationPublisher } from './queue-privacy-publisher.js';
import type { SubjectAnonymizer } from './subject-anonymizer.js';

const TENANT_ID = 'tenant-privacy-spine';

const cleanAnonymizer: SubjectAnonymizer = {
  async anonymize() {
    return { fieldsTouched: ['display_name', 'email', 'phone'] };
  },
};

async function waitUntil(pred: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe('privacy anonymization worker restart-safe spine', () => {
  let store: InMemoryDurableQueueStore;
  let repository: InMemoryPrivacyRepository;

  beforeEach(() => {
    store = new InMemoryDurableQueueStore();
    repository = new InMemoryPrivacyRepository();
  });

  it('redelivers and completes anonymization after consumer crash before ack', async () => {
    const publishAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await publishAdapter.connect();
    const publisher = new QueuePrivacyAnonymizationPublisher(publishAdapter);
    const audit = new RecordingPrivacyAuditPort();

    const service = new PrivacyService(repository, {
      anonymizationPublisher: publisher,
      anonymizer: cleanAnonymizer,
      audit,
    });

    const req = await service.createErasureRequest({
      tenantId: TENANT_ID,
      subjectType: 'student',
      subjectId: 'stu-spine',
      requestedBy: 'officer',
      requestType: 'anonymization',
    });
    await service.transitionErasureRequest(req.id, TENANT_ID, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, TENANT_ID, 'approved', 'officer');
    const started = await service.executeErasure(req.id, TENANT_ID, 'officer');
    expect(started.status).toBe('in_progress');
    expect(store.pendingCount).toBeGreaterThanOrEqual(1);

    let hangResolve!: () => void;
    const hang = new Promise<void>((r) => {
      hangResolve = r;
    });
    let firstAttempts = 0;

    const crashAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    const crashWorker = createPrivacyAnonymizationWorker({
      queue: crashAdapter,
      topic: PRIVACY_ANONYMIZATION_CONSUME_TOPIC,
      processor: {
        processAnonymizationJob: async () => {
          firstAttempts += 1;
          await hang;
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
    const resumeWorker = createPrivacyAnonymizationWorker({
      queue: resumeAdapter,
      topic: PRIVACY_ANONYMIZATION_CONSUME_TOPIC,
      processor: {
        processAnonymizationJob: (jobId, tenantId) =>
          service.processAnonymizationJob(jobId, tenantId),
      },
    });
    await resumeWorker.start();

    await waitUntil(async () => {
      const erasure = await service.getErasureRequest(req.id, TENANT_ID);
      return erasure?.status === 'completed';
    });

    hangResolve();
    await resumeWorker.stop();
    await publishAdapter.disconnect();

    expect(
      (await repository.listAnonymizationJobs(TENANT_ID)).some((j) => j.status === 'completed'),
    ).toBe(true);
  });

  it('fail-closed on redelivery when legal hold appears mid-flight', async () => {
    const publishAdapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    await publishAdapter.connect();
    const publisher = new QueuePrivacyAnonymizationPublisher(publishAdapter);
    const service = new PrivacyService(repository, {
      anonymizationPublisher: publisher,
      anonymizer: cleanAnonymizer,
    });

    const req = await service.createErasureRequest({
      tenantId: TENANT_ID,
      subjectType: 'student',
      subjectId: 'stu-hold',
      requestedBy: 'officer',
    });
    await service.transitionErasureRequest(req.id, TENANT_ID, 'under_review', 'officer');
    await service.transitionErasureRequest(req.id, TENANT_ID, 'approved', 'officer');
    await service.executeErasure(req.id, TENANT_ID, 'officer');

    await service.placeLegalHold({
      tenantId: TENANT_ID,
      scope: 'subject',
      subjectType: 'student',
      subjectId: 'stu-hold',
      reason: 'litigation',
      placedBy: 'counsel',
    });

    const adapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    let seenError = false;
    const worker = createPrivacyAnonymizationWorker({
      queue: adapter,
      processor: {
        async processAnonymizationJob(jobId, tenantId) {
          try {
            await service.processAnonymizationJob(jobId, tenantId);
          } catch (error) {
            seenError = /legal hold/i.test(String(error));
            throw error;
          }
        },
      },
    });
    await worker.start();
    await waitUntil(() => seenError);
    await worker.stop();

    expect((await service.getErasureRequest(req.id, TENANT_ID))?.status).toBe('blocked_legal_hold');
  });
});
