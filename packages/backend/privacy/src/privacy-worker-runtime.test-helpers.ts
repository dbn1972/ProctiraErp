/**
 * PRC-H078 test helpers: gateway-side privacy plugin that only publishes
 * (externalWorkers) plus a dedicated worker runtime over the given queue adapters.
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import Fastify, { type FastifyInstance } from 'fastify';
import { InMemoryPrivacyRepository } from './in-memory-repository.js';
import { privacyPlugin } from './privacy-plugin.js';
import { createPrivacyWorkerRuntime } from './privacy-worker-runtime.js';
import {
  QueuePrivacyAnonymizationPublisher,
  QueuePrivacyOffboardPublisher,
} from './queue-privacy-publisher.js';
import type { SubjectAnonymizer } from './subject-anonymizer.js';

export const TENANT_ID = 'tenant-privacy-runtime';
export const cleanAnonymizer: SubjectAnonymizer = {
  async anonymize() {
    return { fieldsTouched: ['display_name'] };
  },
};

/** Gateway side (publishes only) + dedicated runtime (consumes) over the given adapters. */
export async function buildSplit(adapters: {
  publisher: QueueAdapter;
  anonymization: QueueAdapter;
  offboard: QueueAdapter;
}) {
  const repository = new InMemoryPrivacyRepository();
  await adapters.publisher.connect();
  const app = Fastify();
  await app.register(privacyPlugin, {
    repository,
    anonymizer: cleanAnonymizer,
    anonymizationPublisher: new QueuePrivacyAnonymizationPublisher(adapters.publisher),
    offboardPublisher: new QueuePrivacyOffboardPublisher(adapters.publisher),
    externalWorkers: true,
  });
  await app.ready();
  const runtime = createPrivacyWorkerRuntime({
    repository,
    anonymizer: cleanAnonymizer,
    anonymizationQueue: adapters.anonymization,
    offboardQueue: adapters.offboard,
    sweepIntervalMs: 0,
  });
  return { app, runtime, repository };
}

export async function executeErasure(app: FastifyInstance) {
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

export async function waitForTerminalJob(app: FastifyInstance, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const job = (await app.privacyService.listAnonymizationJobs(TENANT_ID))[0];
    if (job && job.status !== 'queued' && job.status !== 'in_progress') return job;
    if (Date.now() - started > timeoutMs) return job;
    await new Promise((r) => setTimeout(r, 20));
  }
}
