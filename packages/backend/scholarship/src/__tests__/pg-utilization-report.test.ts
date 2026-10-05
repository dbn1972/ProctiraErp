/**
 * PRC-M352: utilization report aggregates in SQL with parameterized date
 * filters instead of loading whole tables into memory.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgScholarshipRepository } from '../pg-scholarship-repository.js';

const TENANT = '00000000-0000-4000-8000-000000000001';

function fakePool(handler: (sql: string, params: unknown[]) => unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: handler(sql, params), rowCount: 0 };
    },
    release: () => undefined,
  };
  return { calls, pool: { connect: async () => client, query: client.query } };
}

describe('PgScholarshipRepository.getUtilizationReport (PRC-M352)', () => {
  it('uses GROUP BY aggregates, date params and per-currency totals', async () => {
    const { calls, pool } = fakePool((sql) => {
      if (sql.includes('FROM scholarship_programs WHERE')) return [{ c: 2 }];
      if (sql.includes('FROM scholarship_disbursements d'))
        return [
          { group_value: 'p1', currency: 'USD', disbursed_count: 1, amount_cents: '1000' },
          { group_value: 'p2', currency: 'INR', disbursed_count: 2, amount_cents: '5000' },
        ];
      if (sql.includes('FROM scholarship_applications a'))
        return [
          { group_value: 'p1', application_count: 3, approved_count: 1 },
          { group_value: 'p2', application_count: 2, approved_count: 2 },
        ];
      return [];
    });
    const repo = new PgScholarshipRepository(pool as never);
    vi.spyOn(repo, 'ensureSchema').mockResolvedValue();
    const report = await repo.getUtilizationReport(TENANT, {
      startDate: '2024-01-01',
      endDate: '2024-06-30',
    });
    const reportSql = calls.filter((c) => /scholarship_/.test(c.sql));
    expect(reportSql.every((c) => !/SELECT \*/.test(c.sql))).toBe(true);
    const disb = reportSql.find((c) => c.sql.includes('FROM scholarship_disbursements d'))!;
    expect(disb.sql).toMatch(/GROUP BY 1, 2/);
    expect(disb.sql).toMatch(/COALESCE\(d\.paid_date, d\.scheduled_date\) >= \$2::date/);
    expect(disb.params).toEqual([TENANT, '2024-01-01', '2024-06-30']);
    const apps = reportSql.find((c) => c.sql.includes('FROM scholarship_applications a'))!;
    expect(apps.sql).toMatch(/a\.submitted_at::date <= \$3::date/);
    expect(report.totalPrograms).toBe(2);
    expect(report.totalApplications).toBe(5);
    expect(report.totalDisbursed).toBe(3);
    expect(report.currency).toBe('MIXED');
    expect(report.currencyTotals).toEqual([
      { currency: 'INR', totalAmountCents: 5000, totalAmount: 50 },
      { currency: 'USD', totalAmountCents: 1000, totalAmount: 10 },
    ]);
  });
});
