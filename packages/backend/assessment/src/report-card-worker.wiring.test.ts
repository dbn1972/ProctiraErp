/**
 * PRC-H039: with a durable queue publisher configured, the assessment plugin
 * starts an in-process report-card consumer so POST /report-cards/generate
 * reaches 'completed' without a manual /process call.
 */
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
} from '@proctira/queue-abstraction';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { assessmentPlugin } from './assessment-plugin.js';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import {
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
} from './in-memory-report-card-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { QueueReportCardPublisher } from './queue-report-card-publisher.js';
import { InMemoryReportCardArtifactStore } from './report-card-artifact-store.js';
import { anyIdReportCardDirectory } from './report-card-test-directory.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTITUTION_ID = '22222222-2222-4222-8222-222222222222';

async function buildApp(
  withWorker: boolean,
  jobRepo: InMemoryReportCardJobRepository = new InMemoryReportCardJobRepository(),
) {
  const store = new InMemoryDurableQueueStore();
  const publisherQueue = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
  await publisherQueue.connect();
  const workerQueue = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
  const brandingRepo = new InMemoryInstitutionBrandingRepository();
  brandingRepo.addBranding({
    institutionId: INSTITUTION_ID,
    tenantId: TENANT_ID,
    name: 'Test School',
    logoUrl: null,
    address: null,
    contactPhone: null,
    contactEmail: null,
  });
  const app = Fastify();
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    const ctx = request as { tenantId?: string; user?: { sub: string; roles: string[] } };
    ctx.tenantId = TENANT_ID;
    ctx.user = { sub: 'teacher-1', roles: ['teacher'] };
  });
  await app.register(assessmentPlugin, {
    gradingSchemeRepository: new InMemoryGradingSchemeRepository(),
    assessmentItemRepository: new InMemoryAssessmentItemRepository(),
    outcomeRepository: new InMemoryOutcomeRepository(),
    resultRepository: new InMemoryAssessmentResultRepository(),
    reportCardTemplateRepository: new InMemoryReportCardTemplateRepository(),
    teacherCommentRepository: new InMemoryTeacherCommentRepository(),
    institutionBrandingRepository: brandingRepo,
    reportCardJobRepository: jobRepo,
    taskQueuePublisher: new QueueReportCardPublisher(publisherQueue),
    reportCardWorkerQueue: withWorker ? workerQueue : undefined,
    pdfGenerator: {
      async generateReportCardPdf() {
        return Buffer.from('%PDF-1.4 report-card');
      },
    },
    reportCardArtifactStore: new InMemoryReportCardArtifactStore(),
    // PRC-H036: jobs fail closed without a name directory; this suite exercises queue wiring.
    reportCardDirectory: anyIdReportCardDirectory,
  });
  app.addHook('onClose', async () => {
    await publisherQueue.disconnect();
  });
  await app.ready();
  return { app, store };
}

async function generate(app: FastifyInstance): Promise<string> {
  const tmpl = await app.inject({
    method: 'POST',
    url: '/report-cards/templates',
    payload: { name: 'Default', templateContent: '<html></html>', isDefault: true },
  });
  expect(tmpl.statusCode).toBe(201);
  const res = await app.inject({
    method: 'POST',
    url: '/report-cards/generate',
    payload: {
      studentId: '33333333-3333-4333-8333-333333333333',
      academicPeriodId: '44444444-4444-4444-8444-444444444444',
      templateId: (tmpl.json() as { id: string }).id,
      institutionId: INSTITUTION_ID,
    },
  });
  expect(res.statusCode).toBe(202);
  return (res.json() as { id: string }).id;
}

async function pollStatus(app: FastifyInstance, jobId: string, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/report-cards/jobs/${jobId}` });
    const status = (res.json() as { status: string }).status;
    if (status === 'completed' || status === 'failed' || Date.now() - started > timeoutMs) {
      return status;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('PRC-H039 report-card worker wiring', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('queue enabled: POST generate reaches completed via the in-process consumer', async () => {
    const built = await buildApp(true);
    app = built.app;
    expect(app.reportCardWorker?.running).toBe(true);
    const jobId = await generate(app);
    expect(await pollStatus(app, jobId)).toBe('completed');
    expect(built.store.pendingCount).toBe(0);
    expect(built.store.inFlightCount).toBe(0);
  });

  it('publisher without a registered consumer falls back to inline processing', async () => {
    const built = await buildApp(false);
    app = built.app;
    expect(app.reportCardWorker).toBeUndefined();
    const jobId = await generate(app);
    expect(await pollStatus(app, jobId, 200)).toBe('completed');
  });

  it('boot reclaims queued jobs across tenants once the consumer is registered', async () => {
    const jobRepo = new InMemoryReportCardJobRepository();
    const tenants = [TENANT_ID, '55555555-5555-4555-8555-555555555555'];
    for (const [i, tenantId] of tenants.entries()) {
      await jobRepo.create({
        id: `6666666${i}-6666-4666-8666-666666666666`,
        tenantId,
        studentId: '33333333-3333-4333-8333-333333333333',
        academicPeriodId: '44444444-4444-4444-8444-444444444444',
        templateId: '77777777-7777-4777-8777-777777777777',
        institutionId: INSTITUTION_ID,
        status: 'queued',
        errorMessage: null,
        outputUrl: null,
      });
    }
    expect(await jobRepo.listTenantIdsWithStatus('queued')).toEqual(tenants);
    const built = await buildApp(true, jobRepo);
    app = built.app;
    expect(app.reportCardWorker?.running).toBe(true);
    const started = Date.now();
    while ((await jobRepo.listTenantIdsWithStatus('queued')).length > 0) {
      if (Date.now() - started > 3000) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    // Each stranded job was re-dispatched and consumed under its own tenant.
    expect(await jobRepo.listTenantIdsWithStatus('queued')).toEqual([]);
  });

  it('stops the worker on close (graceful shutdown)', async () => {
    const built = await buildApp(true);
    const worker = built.app.reportCardWorker!;
    await built.app.close();
    expect(worker.running).toBe(false);
  });
});
