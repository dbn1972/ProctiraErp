/**
 * PRC-H080 — catalogue providers must never fabricate rows.
 * Empty tables -> header-only output; query errors -> run failed, no artifact;
 * production never returns demo rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryFn = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const state: { pool: unknown; query: QueryFn } = {
  pool: null,
  query: async () => ({ rows: [] }),
};

vi.mock('@proctira/database', () => ({
  getSharedPgPool: () => state.pool,
  withPgTenant: async (
    _pool: unknown,
    _tenantId: string,
    fn: (client: { query: QueryFn }) => Promise<unknown>,
  ) => fn({ query: (text, values) => state.query(text, values) }),
}));

const { InMemoryReportBlobStore } = await import('./blob-store.js');
const { CatalogueService } = await import('./catalogue-service.js');
const { InMemoryReportStore } = await import('./report-store.js');
const { fetchCatalogueTable, isReportDemoDataEnabled, ReportDataUnavailableError } =
  await import('./providers.js');

const TENANT = '00000000-0000-4000-8000-0000000000a1';

/** Query stub: every relation exists; data queries return `rows` (or throw). */
function liveDb(rows: unknown[] | Error): void {
  state.pool = {};
  state.query = async (text) => {
    if (text.includes('to_regclass')) return { rows: [{ reg: 'public.x' }] };
    if (rows instanceof Error) throw rows;
    return { rows };
  };
}

describe('PRC-H080 report providers never fabricate data', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.REPORT_DEMO_DATA;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    state.pool = null;
  });

  it('tenant with no invoices -> fee_dues CSV contains header only', async () => {
    liveDb([]);
    const store = new InMemoryReportStore();
    const service = new CatalogueService(store, new InMemoryReportBlobStore());
    const result = await service.generate(TENANT, 'tester', {
      reportKey: 'fee_dues',
      format: 'CSV',
    });
    const lines = result.bytes
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Invoice');
    expect(result.bytes.toString('utf8')).not.toContain('demo-student');
  });

  it('query error -> run status failed and no artifact is stored', async () => {
    liveDb(new Error('column "grade_id" does not exist'));
    const store = new InMemoryReportStore();
    const blobs = new InMemoryReportBlobStore();
    const service = new CatalogueService(store, blobs);
    await expect(
      service.generate(TENANT, 'tester', { reportKey: 'students_roster', format: 'CSV' }),
    ).rejects.toBeInstanceOf(ReportDataUnavailableError);
    const runs = await store.listRuns(TENANT);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.artifactId).toBeNull();
    expect(runs[0]!.error).toMatch(/grade_id/);
  });

  it('missing relation fails explicitly instead of serving demo rows', async () => {
    state.pool = {};
    state.query = async (text) => {
      if (text.includes('to_regclass')) return { rows: [{ reg: null }] };
      return { rows: [] };
    };
    await expect(fetchCatalogueTable(TENANT, 'fee_dues')).rejects.toThrow(/not available/);
  });

  it('production never returns demo rows, even with REPORT_DEMO_DATA=1', async () => {
    const env = { NODE_ENV: 'production', REPORT_DEMO_DATA: '1' } as NodeJS.ProcessEnv;
    expect(isReportDemoDataEnabled(env)).toBe(false);
    await expect(fetchCatalogueTable(TENANT, 'students_roster', {}, env)).rejects.toBeInstanceOf(
      ReportDataUnavailableError,
    );
  });

  it('no pool and no explicit demo flag -> explicit error, not demo rows', async () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    await expect(fetchCatalogueTable(TENANT, 'fee_dues', {}, env)).rejects.toThrow(
      /refusing to fabricate/,
    );
  });

  it('explicit non-production demo mode still serves demo rows', async () => {
    const env = { NODE_ENV: 'development', REPORT_DEMO_DATA: '1' } as NodeJS.ProcessEnv;
    const table = await fetchCatalogueTable(TENANT, 'fee_dues', {}, env);
    expect(table.rows.length).toBeGreaterThan(0);
  });
});
