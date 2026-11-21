/**
 * D1-F3: `relationExists` swallows a failed `to_regclass` probe. Inside the `withPgTenant`
 * transaction that failure used to abort the transaction, so every later dashboard count
 * failed with 25P02 and the whole dashboard was reported unavailable. The probe now runs
 * under a savepoint. The fake client copies Postgres' aborted-transaction semantics.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
type QueryFn = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
const state: { pool: unknown; query: QueryFn } = { pool: null, query: async () => ({ rows: [] }) };
vi.mock('@proctira/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@proctira/database')>()),
  getSharedPgPool: () => state.pool,
  withPgTenant: async (
    _pool: unknown,
    _tenantId: string,
    fn: (client: { query: QueryFn }) => Promise<unknown>,
  ) => fn({ query: (text, values) => state.query(text, values) }),
}));
const { loadDashboardAggregates } = await import('./dashboards.js');
const TENANT = '00000000-0000-4000-8000-0000000000d1';
function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
function transactionalDb(failProbeFor: string): void {
  let aborted = false;
  state.pool = {};
  state.query = async (text, values) => {
    const head = text.trim();
    if (head === 'ROLLBACK' || head.startsWith('ROLLBACK TO SAVEPOINT')) {
      aborted = false;
      return { rows: [] };
    }
    if (aborted) {
      throw pgError(
        '25P02',
        'current transaction is aborted, commands ignored until end of transaction block',
      );
    }
    if (text.includes('to_regclass')) {
      if (values?.[0] === `public.${failProbeFor}`) {
        aborted = true;
        throw pgError('57014', 'canceling statement due to statement timeout');
      }
      return { rows: [{ reg: String(values?.[0]) }] };
    }
    if (text.includes('FROM institutions')) return { rows: [{ n: 2 }] };
    if (text.includes('FROM students')) return { rows: [{ n: 500 }] };
    if (text.includes('FROM enrollments')) return { rows: [{ n: 480 }] };
    if (text.includes('FROM parent_fee_invoices')) return { rows: [{ n: 40 }] };
    if (text.includes('SUM(amount_cents)')) return { rows: [{ n: '1200' }] };
    return { rows: [{ n: 0 }] };
  };
}
describe('dashboard relation probes inside a transaction (D1-F3)', () => {
  afterEach(() => {
    state.pool = null;
  });
  it('a failed probe is a missing table; the counts after it still load', async () => {
    transactionalDb('student_attendance');
    const agg = await loadDashboardAggregates(TENANT, { role: 'principal' });
    expect(agg).toMatchObject({
      schools: 2,
      students: 500,
      enrolments: 480,
      attendancePercent: null,
      openInvoices: 40,
      feesCollectedCents: '1200',
    });
  });
});
