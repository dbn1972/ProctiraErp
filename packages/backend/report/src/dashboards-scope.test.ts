/**
 * PRC-M344 / PRC-M345 — dashboards are caller-scoped, never fabricated, and
 * fee totals are exact bigint sums.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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
const { loadDashboardAggregates, valuesForRole, fmtMoney } = await import('./dashboards.js');
const { CatalogueService } = await import('./catalogue-service.js');
const { InMemoryReportStore } = await import('./report-store.js');
const { InMemoryReportBlobStore } = await import('./blob-store.js');
const { ReportDataUnavailableError } = await import('./providers.js');

const TENANT = '00000000-0000-4000-8000-0000000000d1';
const PARENT = 'parent-user-1';

/** Tiny fake: 1 school, 500 students tenant-wide, parent has 1 active child. */
function fakeDb(seen: Array<{ text: string; values?: unknown[] }>, fail = false): void {
  state.pool = {};
  state.query = async (text, values) => {
    if (text.includes('to_regclass')) return { rows: [{ reg: 'public.x' }] };
    if (fail) throw new Error('connection reset');
    seen.push({ text, values });
    const scoped = text.includes('parent_user_id = $2');
    if (scoped && (values?.[0] !== TENANT || values?.[1] !== PARENT)) return { rows: [{ n: 0 }] };
    if (text.includes('SUM(amount_cents)')) return { rows: [{ n: '3000000000' }] };
    if (text.includes('FROM institutions')) return { rows: [{ n: 1 }] };
    if (text.includes('FROM students')) return { rows: [{ n: scoped ? 1 : 500 }] };
    if (text.includes('FROM parent_fee_invoices')) return { rows: [{ n: scoped ? 1 : 40 }] };
    if (text.includes('FROM student_attendance')) return { rows: [{ n: scoped ? 2 : 900 }] };
    if (text.includes('parent_child_links')) return { rows: [{ n: 1 }] };
    return { rows: [{ n: 0 }] };
  };
}

describe('PRC-M344 caller-scoped dashboards', () => {
  afterEach(() => {
    state.pool = null;
    delete process.env.REPORT_DEMO_DATA;
  });

  it('parent dashboard counts only own linked children', async () => {
    const seen: Array<{ text: string; values?: unknown[] }> = [];
    fakeDb(seen);
    const agg = await loadDashboardAggregates(TENANT, { role: 'parent', userId: PARENT });
    expect(agg.students).toBe(1);
    expect(agg.openInvoices).toBe(1);
    expect(agg.linkedChildren).toBe(1);
    expect(agg.schools).toBe(0);
    // every parent query is bound to the tenant and the caller id
    expect(seen.length).toBeGreaterThan(0);
    for (const q of seen) expect(q.values).toEqual([TENANT, PARENT]);
    const other = await loadDashboardAggregates(TENANT, { role: 'parent', userId: 'someone-else' });
    expect(other.students).toBe(0);
  });

  it('parent queries carry an explicit tenant predicate, not RLS alone', async () => {
    const seen: Array<{ text: string; values?: unknown[] }> = [];
    fakeDb(seen);
    await loadDashboardAggregates(TENANT, { role: 'parent', userId: PARENT });
    const outerTables = ['students', 'student_attendance', 'parent_fee_invoices'];
    for (const table of outerTables) {
      expect(seen.some((q) => q.text.includes(`FROM ${table} `))).toBe(true);
    }
    for (const q of seen) {
      // link subquery: (tenant_id, parent_user_id) — matches idx_parent_child_links_parent
      expect(q.text).toContain(
        'FROM parent_child_links WHERE tenant_id = $1 AND parent_user_id = $2',
      );
      // outer table is also tenant-scoped
      for (const table of outerTables) {
        if (q.text.includes(`FROM ${table} `)) {
          expect(q.text).toContain(`FROM ${table} WHERE tenant_id = $1 AND`);
        }
      }
      expect(q.values?.[0]).toBe(TENANT);
    }
    // a different tenant with the same parent subject sees nothing
    const crossTenant = await loadDashboardAggregates('00000000-0000-4000-8000-0000000000d2', {
      role: 'parent',
      userId: PARENT,
    });
    expect(crossTenant).toMatchObject({ students: 0, openInvoices: 0, linkedChildren: 0 });
  });

  it('parent without an authenticated id is refused (fail closed)', async () => {
    fakeDb([]);
    await expect(loadDashboardAggregates(TENANT, { role: 'parent' })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('DB error -> unavailable, never demo numbers', async () => {
    fakeDb([], true);
    await expect(loadDashboardAggregates(TENANT, { role: 'principal' })).rejects.toBeInstanceOf(
      ReportDataUnavailableError,
    );
    const service = new CatalogueService(new InMemoryReportStore(), new InMemoryReportBlobStore());
    const dash = await service.dashboard(TENANT, [{ roleName: 'Administrator' }], null, 'u1');
    expect(dash.dataStatus).toBe('unavailable');
    expect(dash.cards.every((c) => c.value === '—')).toBe(true);
  });

  it('no pool and no demo opt-in -> unavailable (no fabricated aggregates)', async () => {
    state.pool = null;
    await expect(loadDashboardAggregates(TENANT, { role: 'board' })).rejects.toBeInstanceOf(
      ReportDataUnavailableError,
    );
  });

  it('empty tenant shows real zeros, not demo values', async () => {
    state.pool = {};
    state.query = async (text) =>
      text.includes('to_regclass') ? { rows: [{ reg: 'public.x' }] } : { rows: [{ n: 0 }] };
    const agg = await loadDashboardAggregates(TENANT, { role: 'principal' });
    expect(agg).toMatchObject({ schools: 0, students: 0, enrolments: 0, openInvoices: 0 });
    expect(agg.linkedChildren).toBe(0);
  });
});

describe('PRC-M345 fee total is exact bigint', () => {
  afterEach(() => {
    state.pool = null;
  });

  it('payments summing > 2^31 cents are returned exactly', async () => {
    const seen: Array<{ text: string; values?: unknown[] }> = [];
    fakeDb(seen);
    const agg = await loadDashboardAggregates(TENANT, { role: 'board' });
    expect(agg.feesCollectedCents).toBe('3000000000');
    expect(seen.find((q) => q.text.includes('SUM(amount_cents)'))?.text).toContain('::bigint');
    expect(seen.some((q) => /SUM\(amount_cents\),0\)::int/.test(q.text))).toBe(false);
    const values = valuesForRole('board', agg);
    expect(values['board-fees']).toBe(fmtMoney('3000000000'));
    expect(values['board-fees'].replace(/\D/g, '')).toBe('30000000');
  });
});
