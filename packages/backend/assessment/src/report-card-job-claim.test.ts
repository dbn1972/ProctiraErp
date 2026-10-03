/**
 * PRC-M165 — report-card jobs are claimed with compare-and-set, transient failures
 * are retried by the queue (then dead-lettered), and publish failures are logged.
 */
import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  REPORT_CARD_CONSUME_TOPIC,
} from '@proctira/queue-abstraction';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
} from './in-memory-report-card-repository.js';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { QueueReportCardPublisher } from './queue-report-card-publisher.js';
import type { ReportCardArtifactStore } from './report-card-artifact-store.js';
import { ReportCardService, type ReportCardServiceOptions } from './report-card-service.js';
import { anyIdReportCardDirectory } from './report-card-test-directory.js';
import { createReportCardWorker } from './report-card-worker.js';
import { ResultService } from './result-service.js';

const TENANT_ID = 'tenant-rc-m165';

async function waitUntil(pred: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('report-card job processing (PRC-M165)', () => {
  let jobRepo: InMemoryReportCardJobRepository;
  let templateRepo: InMemoryReportCardTemplateRepository;
  let resultService: ResultService;
  let itemRepo: InMemoryAssessmentItemRepository;
  let resultRepo: InMemoryAssessmentResultRepository;
  const adapters: InMemoryDurableQueueAdapter[] = [];

  beforeEach(async () => {
    jobRepo = new InMemoryReportCardJobRepository();
    templateRepo = new InMemoryReportCardTemplateRepository();
    itemRepo = new InMemoryAssessmentItemRepository();
    resultRepo = new InMemoryAssessmentResultRepository();
    resultService = new ResultService(resultRepo, itemRepo, new InMemoryGradingSchemeRepository());
    await templateRepo.create({
      id: 'tmpl-1',
      tenantId: TENANT_ID,
      name: 'Default',
      templateContent: '<title>T</title>',
      isDefault: true,
      includeComments: false,
      includeLogo: false,
      includeGradeSummary: true,
    } as never);
  });

  afterEach(async () => {
    for (const a of adapters.splice(0)) if (a.isConnected()) await a.disconnect();
  });

  function build(
    generate: () => Promise<Buffer>,
    extra: Partial<ReportCardServiceOptions> = {},
    publisher: { publish: (...args: never[]) => Promise<void> } | null = null,
  ): ReportCardService {
    return new ReportCardService(
      templateRepo,
      new InMemoryTeacherCommentRepository(),
      new InMemoryInstitutionBrandingRepository(),
      jobRepo,
      resultService,
      itemRepo,
      publisher as never,
      { generateReportCardPdf: generate },
      {
        resultRepository: resultRepo,
        directory: anyIdReportCardDirectory,
        ...extra,
      },
    );
  }

  async function seedJob(id = 'job-1') {
    return jobRepo.create({
      id,
      tenantId: TENANT_ID,
      studentId: 'stu-1',
      academicPeriodId: 'p-1',
      templateId: 'tmpl-1',
      institutionId: 'inst-1',
      status: 'queued',
      errorMessage: null,
      outputUrl: null,
    });
  }

  it('two concurrent process calls produce one PDF', async () => {
    const generate = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return Buffer.from('%PDF-1.4 x');
    });
    const service = build(generate);
    const job = await seedJob();
    const [a, b] = await Promise.all([
      service.processReportCardJob(TENANT_ID, job.id),
      service.processReportCardJob(TENANT_ID, job.id),
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual(['completed', 'processing']);
    expect((await jobRepo.findById(job.id, TENANT_ID))!.status).toBe('completed');
    // Redelivery after completion is a no-op.
    await service.processReportCardJob(TENANT_ID, job.id);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('stale processing rows can be reclaimed; fresh ones cannot', async () => {
    const generate = vi.fn(async () => Buffer.from('%PDF-1.4 x'));
    const job = await seedJob();
    await jobRepo.updateStatus(job.id, TENANT_ID, 'processing');
    const fresh = build(generate);
    expect((await fresh.processReportCardJob(TENANT_ID, job.id)).status).toBe('processing');
    expect(generate).not.toHaveBeenCalled();
    const stale = build(generate, { staleProcessingMs: -1 });
    expect((await stale.processReportCardJob(TENANT_ID, job.id)).status).toBe('completed');
  });

  it('a simulated store failure is retried by the queue, then dead-lettered', async () => {
    const store = new InMemoryDurableQueueStore();
    const adapter = new InMemoryDurableQueueAdapter({ store, pollIntervalMs: 5 });
    adapters.push(adapter);
    await adapter.connect();
    const failingStore: ReportCardArtifactStore = {
      put: vi.fn(async () => {
        throw new Error('object store unavailable');
      }),
      get: async () => null,
    } as never;
    const logger = { warn: vi.fn(), error: vi.fn() };
    const service = build(async () => Buffer.from('%PDF-1.4 x'), {
      artifactStore: failingStore,
      logger,
    }, new QueueReportCardPublisher(adapter));
    const job = await service.queueReportCardGeneration(TENANT_ID, {
      studentId: 'stu-1',
      academicPeriodId: 'p-1',
      institutionId: 'inst-1',
      templateId: 'tmpl-1',
    });
    const worker = createReportCardWorker({
      queue: adapter,
      processor: service,
      topic: REPORT_CARD_CONSUME_TOPIC,
    });
    await worker.start();
    await waitUntil(() => store.deadLetterCount === 1);
    await worker.stop();
    // 1 delivery + 3 retries (publisher maxRetries=3).
    expect((failingStore.put as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
    expect((await jobRepo.findById(job.id, TENANT_ID))!.status).toBe('failed');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: job.id, retryable: true }),
      'report-card job failed',
    );
  });

  it('inline callers get the stored failed job instead of an exception', async () => {
    const service = build(async () => {
      throw new Error('renderer crashed');
    });
    const job = await seedJob();
    const res = await service.processReportCardJob(TENANT_ID, job.id);
    expect(res.status).toBe('failed');
  });

  it('logs publish failures with the jobId and leaves the job queued', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const service = build(async () => Buffer.from('%PDF-1.4 x'), { logger }, {
      publish: async () => {
        throw new Error('broker down');
      },
    });
    const job = await service.queueReportCardGeneration(TENANT_ID, {
      studentId: 'stu-1',
      academicPeriodId: 'p-1',
      institutionId: 'inst-1',
      templateId: 'tmpl-1',
    });
    expect(job.status).toBe('queued');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: job.id, err: 'broker down' }),
      expect.stringContaining('publish failed'),
    );
  });
});
