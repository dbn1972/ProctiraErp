/**
 * PRC-H078: with durable privacy publishers configured, privacyPlugin starts
 * the anonymization + offboard consumers so executed erasures reach a
 * terminal job state without manual processing.
 */
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
} from '@proctira/queue-abstraction';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { privacyPlugin } from './privacy-plugin.js';
import {
  QueuePrivacyAnonymizationPublisher,
  QueuePrivacyOffboardPublisher,
} from './queue-privacy-publisher.js';
import type { SubjectAnonymizer } from './subject-anonymizer.js';

const TENANT_ID = 'tenant-privacy-wiring';

const cleanAnonymizer: SubjectAnonymizer = {
  async anonymize() {
    return { fieldsTouched: ['display_name', 'email'] };
  },
};

async function buildApp(withWorkers: boolean) {
  const store = new InMemoryDurableQueueStore();
  const publisherQueue = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
  await publisherQueue.connect();
  const repository = new InMemoryPrivacyRepository();
  const app = Fastify();
  await app.register(privacyPlugin, {
    repository,
    anonymizer: cleanAnonymizer,
    anonymizationPublisher: new QueuePrivacyAnonymizationPublisher(publisherQueue),
    offboardPublisher: new QueuePrivacyOffboardPublisher(publisherQueue),
    anonymizationWorkerQueue: withWorkers
      ? new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 })
      : undefined,
    offboardWorkerQueue: withWorkers
      ? new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 })
      : undefined,
  });
  app.addHook('onClose', async () => {
    await publisherQueue.disconnect();
  });
  await app.ready();
  return { app, store };
}

async function executeErasure(app: FastifyInstance) {
  const service = app.privacyService;
  const req = await service.createErasureRequest({
    tenantId: TENANT_ID,
    subjectType: 'student',
    subjectId: 'stu-1',
    requestedBy: 'officer',
    requestType: 'anonymization',
  });
  await service.transitionErasureRequest(req.id, TENANT_ID, 'under_review', 'officer');
  await service.transitionErasureRequest(req.id, TENANT_ID, 'approved', 'officer');
  return service.executeErasure(req.id, TENANT_ID, 'officer');
}

async function waitForTerminalJob(app: FastifyInstance, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    const jobs = await app.privacyService.listAnonymizationJobs(TENANT_ID);
    const job = jobs[0];
    if (job && job.status !== 'queued' && job.status !== 'in_progress') return job;
    if (Date.now() - started > timeoutMs) return job;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('PRC-H078 privacy worker wiring', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('queue enabled: execute erasure reaches a terminal job via the in-process consumer', async () => {
    const built = await buildApp(true);
    app = built.app;
    expect(app.privacyWorkers?.map((w) => w.running)).toEqual([true, true]);
    const started = await executeErasure(app);
    expect(started.status).toBe('in_progress');
    const job = await waitForTerminalJob(app);
    expect(job?.status).toBe('completed');
    expect(built.store.pendingCount).toBe(0);
    expect(built.store.inFlightCount).toBe(0);
  });

  it('publisher without a consumer falls back to inline processing', async () => {
    const built = await buildApp(false);
    app = built.app;
    expect(app.privacyWorkers).toBeUndefined();
    await executeErasure(app);
    const job = await waitForTerminalJob(app, 100);
    expect(job?.status).toBe('completed');
    expect(built.store.pendingCount).toBe(0);
  });

  it('stops both workers on close', async () => {
    const built = await buildApp(true);
    const workers = built.app.privacyWorkers!;
    await built.app.close();
    expect(workers.every((w) => !w.running)).toBe(true);
  });
});
