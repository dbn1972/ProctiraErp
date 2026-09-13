import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@proctira/common';

import { InMemoryReportBlobStore } from './blob-store.js';
import { CatalogueService, MAX_CATALOGUE_REPORT_ROWS } from './catalogue-service.js';
import { InMemoryReportRepository } from './in-memory-repository.js';
import * as providers from './providers.js';
import type { ReportDataSource, ReportUserContext } from './report-repository.js';
import { InMemoryReportStore } from './report-store.js';
import { MAX_SYNC_REPORT_ROWS, ReportService } from './report-service.js';

const TENANT = '00000000-0000-4000-8000-000000000001';

describe('W2-RPT-01 report row caps (behavioral)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('catalogue generate throws when fetched rows exceed the hard cap', async () => {
    vi.spyOn(providers, 'fetchCatalogueTable').mockResolvedValue({
      columns: [{ name: 'id', label: 'ID' }],
      rows: Array.from({ length: MAX_CATALOGUE_REPORT_ROWS + 1 }, (_, i) => ({ id: String(i) })),
    });
    const service = new CatalogueService(new InMemoryReportStore(), new InMemoryReportBlobStore());
    await expect(
      service.generate(TENANT, 'tester', { reportKey: 'students_roster', format: 'csv' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('sync ReportService.processReportJob refuses oversized inline results', async () => {
    const dataSource: ReportDataSource = {
      async fetchData() {
        return {
          rows: [],
          columns: [],
          totalRows: MAX_SYNC_REPORT_ROWS + 1,
        };
      },
    };
    const repo = new InMemoryReportRepository();
    const service = new ReportService(repo, dataSource);
    const ctx: ReportUserContext = {
      userId: 'u1',
      tenantId: TENANT,
      areaId: null,
      roleId: 'admin',
      institutionIds: [],
      accessibleAreaIds: [],
    };
    const job = await service.generateReport(
      TENANT,
      { reportType: 'students', format: 'csv', filters: {} },
      ctx,
    );
    expect(job.status).toBe('failed');
    expect(job.errorMessage ?? '').toMatch(/capped|exceed/i);
  });
});
