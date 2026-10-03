/**
 * PRC-H039: broker-backed report-card queue path.
 *
 * Runs only when RABBITMQ_URL is set (CI integration-test job provides a RabbitMQ service).
 * Proves that with the durable queue enabled a queued report-card job reaches 'completed'
 * through a real broker without a manual /process call, and that a job queued while no
 * consumer was bound (unroutable mandatory dispatch) is recovered by the worker's
 * cross-tenant boot reclaim.
 */
import { randomUUID } from 'node:crypto';
import { RabbitMQAdapter, REPORT_CARD_CONSUME_TOPIC } from '@proctira/queue-abstraction';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { anyIdReportCardDirectory } from './report-card-test-directory.js';
import { createReportCardWorker, type ReportCardWorker } from './report-card-worker.js';
import { ResultService } from './result-service.js';

const RABBITMQ_URL = process.env['RABBITMQ_URL'];

describe.skipIf(!RABBITMQ_URL)('PRC-H039 report-card queue over RabbitMQ', () => {
  const runId = randomUUID().slice(0, 8);
  // Fresh exchange per test so no queue bound by an earlier test can route a message.
  let exchange = '';
  const groupId = `h039-${runId}`;
  const adapters: RabbitMQAdapter[] = [];
  let worker: ReportCardWorker | null = null;
  let jobRepo: InMemoryReportCardJobRepository;
  let service: ReportCardService;

  function adapter(): RabbitMQAdapter {
    const a = new RabbitMQAdapter(
      { url: RABBITMQ_URL!, exchange, deadLetterExchange: `${exchange}.dlx`, durable: false },
      { depthSampleIntervalMs: 0 },
    );
    adapters.push(a);
    return a;
  }

  async function seedService(publisherAdapter: RabbitMQAdapter, tenantId: string) {
    jobRepo = new InMemoryReportCardJobRepository();
    const templateRepo = new InMemoryReportCardTemplateRepository();
    const brandingRepo = new InMemoryInstitutionBrandingRepository();
    const itemRepo = new InMemoryAssessmentItemRepository();
    const resultRepo = new InMemoryAssessmentResultRepository();
    const resultService = new ResultService(
      resultRepo,
      itemRepo,
      new InMemoryGradingSchemeRepository(),
    );
    await templateRepo.create({
      id: 'tmpl-1',
      tenantId,
      name: 'Default',
      templateContent: '<html>{{student.name}}</html>',
      isDefault: true,
      includeComments: false,
      includeLogo: false,
      includeGradeSummary: true,
    });
    brandingRepo.addBranding({
      institutionId: 'inst-1',
      tenantId,
      name: 'Test School',
      logoUrl: null,
      address: null,
      contactPhone: null,
      contactEmail: null,
    });
    await publisherAdapter.connect();
    service = new ReportCardService(
      templateRepo,
      new InMemoryTeacherCommentRepository(),
      brandingRepo,
      jobRepo,
      resultService,
      itemRepo,
      new QueueReportCardPublisher(publisherAdapter),
      {
        async generateReportCardPdf() {
          return Buffer.from('%PDF-1.4 report-card');
        },
      },
      { processInline: false, resultRepository: resultRepo, directory: anyIdReportCardDirectory },
    );
  }

  beforeEach(() => {
    worker = null;
    exchange = `proctira.test.h039.${randomUUID().slice(0, 8)}`;
  });

  afterEach(async () => {
    await worker?.stop();
    for (const a of adapters.splice(0)) await a.disconnect();
  });

  it('queued job reaches completed through the broker without a manual /process', async () => {
    const tenantId = `tenant-h039-a-${runId}`;
    await seedService(adapter(), tenantId);
    worker = createReportCardWorker({
      queue: adapter(),
      processor: service,
      topic: REPORT_CARD_CONSUME_TOPIC,
      groupId,
    });
    await worker.start();
    const job = await service.queueReportCardGeneration(tenantId, {
      studentId: 'stu-1',
      academicPeriodId: 'period-1',
      institutionId: 'inst-1',
      templateId: 'tmpl-1',
    });
    await waitUntil(
      async () => (await service.getJobStatus(tenantId, job.id)).status === 'completed',
    );
  });

  it('job queued before any consumer is bound is recovered by boot reclaim', async () => {
    const tenantId = `tenant-h039-b-${runId}`;
    await seedService(adapter(), tenantId);
    const lateGroup = `${groupId}-late`;
    // No queue is bound yet: the mandatory dispatch is returned unroutable, the service
    // swallows the publish failure and the job stays 'queued' (PRC-H087 + W2-JOB-02).
    const job = await service.queueReportCardGeneration(tenantId, {
      studentId: 'stu-2',
      academicPeriodId: 'period-1',
      institutionId: 'inst-1',
      templateId: 'tmpl-1',
    });
    expect((await service.getJobStatus(tenantId, job.id)).status).toBe('queued');
    worker = createReportCardWorker({
      queue: adapter(),
      processor: service,
      topic: REPORT_CARD_CONSUME_TOPIC,
      groupId: lateGroup,
      reclaimAllTenants: true,
    });
    await worker.start();
    await waitUntil(
      async () => (await service.getJobStatus(tenantId, job.id)).status === 'completed',
    );
  });
});

async function waitUntil(pred: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!(await pred())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
