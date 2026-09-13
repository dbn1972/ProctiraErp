/**
 * W2-JOB-13 — report job leasing, dedupe keys, and cancellation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@proctira/common';

import { InMemoryReportRepository } from './in-memory-repository.js';
import type {
  ReportDataSource,
  ReportDataResult,
  ReportJobEntity,
  ReportUserContext,
} from './report-repository.js';
import { ReportService } from './report-service.js';
import type { AggregationConfig } from './schemas.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function createUserContext(): ReportUserContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    roleId: 'admin-role',
    areaId: 'area-1',
    institutionIds: ['inst-1'],
    accessibleAreaIds: ['area-1'],
  };
}

class HoldingDataSource implements ReportDataSource {
  resolve!: () => void;
  private readonly gate = new Promise<void>((r) => {
    this.resolve = r;
  });

  async fetchData(): Promise<ReportDataResult> {
    await this.gate;
    return {
      rows: [{ name: 'A' }],
      columns: [{ name: 'name', type: 'string' }],
      totalRows: 1,
    };
  }
}

class InstantDataSource implements ReportDataSource {
  async fetchData(
    _tenantId: string,
    _reportType: string,
    _filters: Record<string, unknown>,
    _groupBy: string[] | null,
    _aggregations: AggregationConfig[] | null,
  ): Promise<ReportDataResult> {
    return {
      rows: [{ name: 'A' }],
      columns: [{ name: 'name', type: 'string' }],
      totalRows: 1,
    };
  }
}

describe('W2-JOB-13 report job lease / dedupe / cancel', () => {
  let repository: InMemoryReportRepository;

  beforeEach(() => {
    repository = new InMemoryReportRepository();
  });

  it('returns the active job when the same dedupeKey is submitted again', async () => {
    const queue: ReportJobEntity[] = [];
    const service = new ReportService(
      repository,
      new InstantDataSource(),
      undefined,
      undefined,
      undefined,
      {
        async queueReportJob(job) {
          queue.push(job);
        },
      },
    );

    const first = await service.generateReport(
      TENANT_ID,
      {
        reportType: 'students',
        format: 'csv',
        filters: {},
        dedupeKey: 'roster-monday',
      },
      createUserContext(),
    );
    expect(first.status).toBe('queued');
    expect(first.dedupeKey).toBe('roster-monday');

    const second = await service.generateReport(
      TENANT_ID,
      {
        reportType: 'students',
        format: 'csv',
        filters: {},
        dedupeKey: 'roster-monday',
      },
      createUserContext(),
    );
    expect(second.id).toBe(first.id);
    expect(queue).toHaveLength(1);
  });

  it('cancels a queued job so claim/process refuses it', async () => {
    const service = new ReportService(
      repository,
      new InstantDataSource(),
      undefined,
      undefined,
      undefined,
      {
        async queueReportJob() {
          /* leave queued */
        },
      },
    );

    const job = await service.generateReport(
      TENANT_ID,
      { reportType: 'students', format: 'csv', filters: {}, dedupeKey: 'cancel-me' },
      createUserContext(),
    );
    expect(job.status).toBe('queued');

    const cancelled = await service.cancelReportJob(TENANT_ID, job.id);
    expect(cancelled.status).toBe('cancelled');

    await expect(service.processReportJob(job, createUserContext())).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('claim leases a queued job so a second worker cannot double-process', async () => {
    const holding = new HoldingDataSource();
    const service = new ReportService(
      repository,
      holding,
      undefined,
      undefined,
      undefined,
      {
        async queueReportJob() {
          /* leave queued for explicit process */
        },
      },
    );

    const job = await service.generateReport(
      TENANT_ID,
      { reportType: 'students', format: 'csv', filters: {} },
      createUserContext(),
    );

    const first = service.processReportJob(job, createUserContext());
    // Allow the first worker to claim before the second tries.
    await new Promise((r) => setTimeout(r, 10));
    await expect(service.processReportJob(job, createUserContext())).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    holding.resolve();
    const done = await first;
    expect(done.status).toBe('completed');
  });
});
