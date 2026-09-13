/**
 * W2-JOB-02: report-card generation queue durability.
 *
 * Tip verification (CONFIRMED dual-write without reclaim):
 *   report-card-service.ts queueReportCardGeneration → jobRepo.create then
 *   taskQueuePublisher.publish. Crash after DB commit leaves status=queued
 *   with no queue message and no recovery path.
 *
 * Fix: swallow publish errors (job stays queued) + reclaimQueuedJobs /
 *   durable QueueReportCardPublisher + worker restart-safe consume.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  REPORT_CARD_CONSUME_TOPIC,
  REPORT_CARD_JOB_TYPE,
  buildTenantName,
} from '@proctira/queue-abstraction';

import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
} from './in-memory-repository.js';
import {
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
} from './in-memory-report-card-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { QueueReportCardPublisher } from './queue-report-card-publisher.js';
import { ReportCardService } from './report-card-service.js';
import { createReportCardWorker } from './report-card-worker.js';
import { ResultService } from './result-service.js';

const TENANT_ID = 'tenant-rc-durable';

describe('W2-JOB-02 report-card queue durability', () => {
  let jobRepo: InMemoryReportCardJobRepository;
  let templateRepo: InMemoryReportCardTemplateRepository;
  let commentRepo: InMemoryTeacherCommentRepository;
  let brandingRepo: InMemoryInstitutionBrandingRepository;
  let itemRepo: InMemoryAssessmentItemRepository;
  let resultRepo: InMemoryAssessmentResultRepository;
  let resultService: ResultService;
  let durableStore: InMemoryDurableQueueStore;
  let queue: InMemoryDurableQueueAdapter;

  beforeEach(async () => {
    jobRepo = new InMemoryReportCardJobRepository();
    templateRepo = new InMemoryReportCardTemplateRepository();
    commentRepo = new InMemoryTeacherCommentRepository();
    brandingRepo = new InMemoryInstitutionBrandingRepository();
    itemRepo = new InMemoryAssessmentItemRepository();
    resultRepo = new InMemoryAssessmentResultRepository();
    const schemeRepo = new InMemoryGradingSchemeRepository();
    resultService = new ResultService(resultRepo, itemRepo, schemeRepo);
    durableStore = new InMemoryDurableQueueStore();
    queue = new InMemoryDurableQueueAdapter({ store: durableStore, pollIntervalMs: 5 });
    await queue.connect();

    await templateRepo.create({
      id: 'tmpl-1',
      tenantId: TENANT_ID,
      name: 'Default',
      templateContent: '<html>{{student.name}}</html>',
      isDefault: true,
      includeComments: false,
      includeLogo: false,
      includeGradeSummary: true,
    });
    brandingRepo.addBranding({
      institutionId: 'inst-1',
      tenantId: TENANT_ID,
      name: 'Test School',
      logoUrl: null,
      address: null,
      contactPhone: null,
      contactEmail: null,
    });
  });

  afterEach(async () => {
    if (queue.isConnected()) await queue.disconnect();
  });

  function createService(
    publisher: QueueReportCardPublisher | { publish: (...args: never[]) => Promise<void> } | null,
    processInline = false,
  ) {
    return new ReportCardService(
      templateRepo,
      commentRepo,
      brandingRepo,
      jobRepo,
      resultService,
      itemRepo,
      publisher as QueueReportCardPublisher | null,
      {
        async generateReportCardPdf() {
          return Buffer.from('%PDF-1.4 report-card');
        },
      },
      { processInline, resultRepository: resultRepo },
    );
  }

  it('CONFIRMED tip dual-write: create then publish crash leaves orphan queued job', async () => {
    const crashingPublisher = {
      async publish(): Promise<void> {
        throw new Error('broker unavailable after job commit');
      },
    };
    const tipService = createService(crashingPublisher);

    const job = await jobRepo.create({
      id: 'job-orphan',
      tenantId: TENANT_ID,
      studentId: 'stu-1',
      academicPeriodId: 'period-1',
      templateId: 'tmpl-1',
      institutionId: 'inst-1',
      status: 'queued',
      errorMessage: null,
      outputUrl: null,
    });
    await expect(crashingPublisher.publish()).rejects.toThrow(/broker unavailable/);
    expect((await tipService.getJobStatus(TENANT_ID, job.id)).status).toBe('queued');
    expect(durableStore.pendingCount).toBe(0);
  });

  it('swallows publish failure and reclaimQueuedJobs re-dispatches', async () => {
    let fail = true;
    const flaky = {
      async publish(task: {
        id: string;
        tenantId: string;
        type: string;
        payload: unknown;
        options: { priority: number; delay: number; maxRetries: number; retryCount: number };
      }): Promise<void> {
        if (fail) {
          fail = false;
          throw new Error('broker unavailable after job commit');
        }
        await new QueueReportCardPublisher(queue).publish(task);
      },
    };

    const service = createService(flaky);
    const job = await service.queueReportCardGeneration(TENANT_ID, {
      studentId: 'stu-1',
      academicPeriodId: 'period-1',
      institutionId: 'inst-1',
      templateId: 'tmpl-1',
    });

    expect(job.status).toBe('queued');
    expect(durableStore.pendingCount).toBe(0);

    const reclaimed = await service.reclaimQueuedJobs(TENANT_ID);
    expect(reclaimed).toBe(1);
    expect(durableStore.pendingCount).toBe(1);

    const leased = durableStore.leaseMatching(buildTenantName(TENANT_ID, REPORT_CARD_JOB_TYPE));
    expect(leased).not.toBeNull();
    expect((leased!.message.payload as { jobId: string }).jobId).toBe(job.id);
  });

  it('worker redelivers and completes after crash before ack', async () => {
    const publishAdapter = new InMemoryDurableQueueAdapter({ store: durableStore, pollIntervalMs: 5 });
    await publishAdapter.connect();
    const publisher = new QueueReportCardPublisher(publishAdapter);
    const service = createService(publisher);

    const job = await service.queueReportCardGeneration(TENANT_ID, {
      studentId: 'stu-1',
      academicPeriodId: 'period-1',
      institutionId: 'inst-1',
      templateId: 'tmpl-1',
    });
    expect(durableStore.pendingCount).toBe(1);

    let hangResolve!: () => void;
    const hang = new Promise<void>((r) => {
      hangResolve = r;
    });
    let firstAttempts = 0;

    const crashAdapter = new InMemoryDurableQueueAdapter({ store: durableStore, pollIntervalMs: 5 });
    const crashWorker = createReportCardWorker({
      queue: crashAdapter,
      topic: REPORT_CARD_CONSUME_TOPIC,
      processor: {
        processReportCardJob: async () => {
          firstAttempts += 1;
          await hang;
          return null;
        },
      },
    });
    await crashWorker.start();
    await waitUntil(() => durableStore.inFlightCount === 1);
    expect(firstAttempts).toBe(1);

    await crashWorker.stop();
    expect(durableStore.pendingCount).toBeGreaterThanOrEqual(1);
    expect(durableStore.inFlightCount).toBe(0);

    const resumeAdapter = new InMemoryDurableQueueAdapter({ store: durableStore, pollIntervalMs: 5 });
    const resumeWorker = createReportCardWorker({
      queue: resumeAdapter,
      processor: service,
      topic: REPORT_CARD_CONSUME_TOPIC,
    });
    await resumeWorker.start();

    await waitUntil(async () => {
      const status = await service.getJobStatus(TENANT_ID, job.id);
      return status.status === 'completed';
    }, 4000);

    hangResolve();
    await resumeWorker.stop();
    await publishAdapter.disconnect();
    expect((await service.getJobStatus(TENANT_ID, job.id)).status).toBe('completed');
  });
});

async function waitUntil(pred: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}
