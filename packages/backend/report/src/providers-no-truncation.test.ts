/**
 * PRC-M342 — providers must not silently truncate. They fetch cap+1 rows so
 * >cap is rejected (400) and anything <= cap is exported in full.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@proctira/common';

type QueryFn = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const state: { pool: unknown; query: QueryFn } = { pool: null, query: async () => ({ rows: [] }) };
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
const { CATALOGUE_FETCH_LIMIT, MAX_CATALOGUE_REPORT_ROWS } = await import('./providers.js');

const TENANT = '00000000-0000-4000-8000-0000000000a2';

function studentsDb(count: number, seen: unknown[][]): void {
  state.pool = {};
  state.query = async (text, values) => {
    if (text.includes('to_regclass')) return { rows: [{ reg: 'public.students' }] };
    seen.push(values ?? []);
    const limit = Number(values?.[0] ?? Infinity);
    const n = Math.min(count, limit);
    return {
      rows: Array.from({ length: n }, (_, i) => ({
        student_id: `s${i}`,
        first_name: 'F',
        last_name: `L${i}`,
        gender: 'x',
        date_of_birth: '2015-01-01',
      })),
    };
  };
}

describe('PRC-M342 catalogue providers do not truncate', () => {
  afterEach(() => {
    state.pool = null;
  });

  it('fetch limit is cap+1', () => {
    expect(CATALOGUE_FETCH_LIMIT).toBe(MAX_CATALOGUE_REPORT_ROWS + 1);
  });

  it('exports all 501+ students (no LIMIT 500 truncation)', async () => {
    const seen: unknown[][] = [];
    studentsDb(750, seen);
    const service = new CatalogueService(new InMemoryReportStore(), new InMemoryReportBlobStore());
    const result = await service.generate(TENANT, 'tester', {
      reportKey: 'students_roster',
      format: 'csv',
    });
    const lines = result.bytes.toString('utf8').trim().split('\n');
    expect(lines).toHaveLength(751);
    expect(seen.some((v) => v[0] === CATALOGUE_FETCH_LIMIT)).toBe(true);
  });

  it('more than the cap -> ValidationError (400), not a truncated READY report', async () => {
    studentsDb(MAX_CATALOGUE_REPORT_ROWS + 5, []);
    const service = new CatalogueService(new InMemoryReportStore(), new InMemoryReportBlobStore());
    await expect(
      service.generate(TENANT, 'tester', { reportKey: 'students_roster', format: 'csv' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
