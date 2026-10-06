/**
 * PRC-H089 — mid-month offboard pay follows the PAYROLL_PRORATION policy, and the payroll
 * run iterates the whole tenant via keyset paging when the repository supports it.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import {
  prorateMonthlyGrossCents,
  resolvePayrollProrationPolicy,
  type PayrollProrationPolicy,
} from './payroll-compute.js';
import type { StaffEntity } from './staff-repository.js';
import { StaffService } from './staff-service.js';

/** Keyset-capable repo; `list` throws so the test proves keyset is used. */
class KeysetStaffRepository extends InMemoryStaffRepository {
  keysetCalls = 0;
  async listAfterId(
    tenantId: string,
    afterId: string | null,
    limit: number,
  ): Promise<StaffEntity[]> {
    this.keysetCalls += 1;
    const all = await super.list(tenantId, {}, { page: 1, pageSize: 100_000, sortBy: 'id' });
    return all.data
      .filter((s) => afterId === null || s.id > afterId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit);
  }
  override async list(): Promise<never> {
    throw new Error('offset list must not be used when keyset is available');
  }
}

async function setup(policy?: PayrollProrationPolicy) {
  const tenantId = randomUUID();
  const store = new InMemoryStaffHrStore();
  const staffService = new StaffService(new InMemoryStaffRepository());
  const hr = new StaffHrService(store, staffService, { payrollProration: policy });
  const staff = await staffService.create(tenantId, {
    firstName: 'Mid',
    lastName: 'Month',
    dateOfBirth: '1985-01-01',
    identityNumber: `PR-${randomUUID().slice(0, 8)}`,
    contactPhone: '+15550001',
    position: 'Teacher',
  });
  // 2026-09: 30 calendar days, 22 weekdays. Offboard 2026-09-15 (Tue):
  // 15 calendar days, 11 weekdays.
  await hr.createContract(tenantId, {
    staffId: staff.id,
    contractType: 'permanent',
    startDate: '2026-01-01',
    monthlyGrossCents: 300_000,
  });
  await staffService.offboard(tenantId, staff.id, { effectiveDate: '2026-09-15' }, 'hr-1');
  return { tenantId, hr, staffId: staff.id };
}

describe('PRC-H089 payroll proration policy', () => {
  it('defaults to calendar_days when unset; rejects unknown values (fail closed)', () => {
    expect(resolvePayrollProrationPolicy(undefined)).toBe('calendar_days');
    expect(resolvePayrollProrationPolicy('  ')).toBe('calendar_days');
    expect(resolvePayrollProrationPolicy('WORKING_DAYS')).toBe('working_days');
    expect(resolvePayrollProrationPolicy('full_month')).toBe('full_month');
    expect(() => resolvePayrollProrationPolicy('pro-rata')).toThrow(/PAYROLL_PRORATION/);
  });

  it('calendar_days (default) pays 15/30 of gross for a 2026-09-15 offboard', async () => {
    const { tenantId, hr, staffId } = await setup();
    const run = await hr.exportPayroll(tenantId, { month: '2026-09' });
    const row = run.rows.find((r) => r.staffId === staffId)!;
    expect(row.grossCents).toBe(150_000);
    expect(row.netCents).toBe(150_000);
    expect(row.proration).toEqual({
      policy: 'calendar_days',
      lastDay: '2026-09-15',
      eligibleDays: 15,
      periodDays: 30,
      fullMonthGrossCents: 300_000,
    });
    expect(run.trialBalance.debitCents).toBe(run.trialBalance.creditCents);
  });

  it('working_days pays 11/22 weekdays', async () => {
    const { tenantId, hr, staffId } = await setup('working_days');
    const run = await hr.exportPayroll(tenantId, { month: '2026-09' });
    const row = run.rows.find((r) => r.staffId === staffId)!;
    expect(row.grossCents).toBe(150_000);
    expect(row.proration?.eligibleDays).toBe(11);
    expect(row.proration?.periodDays).toBe(22);
  });

  it('full_month pays the full gross', async () => {
    const { tenantId, hr, staffId } = await setup('full_month');
    const run = await hr.exportPayroll(tenantId, { month: '2026-09' });
    expect(run.rows.find((r) => r.staffId === staffId)!.grossCents).toBe(300_000);
  });

  it('offboard on the last day of the month is not pro-rated', () => {
    const r = prorateMonthlyGrossCents({
      monthlyGrossCents: 100_001,
      policy: 'calendar_days',
      monthStart: '2026-02-01',
      monthEnd: '2026-02-28',
      lastDay: '2026-02-28',
    });
    expect(r.grossCents).toBe(100_001);
  });

  it('floors uneven calendar-day proration', () => {
    const r = prorateMonthlyGrossCents({
      monthlyGrossCents: 100_000,
      policy: 'calendar_days',
      monthStart: '2026-01-01',
      monthEnd: '2026-01-31',
      lastDay: '2026-01-10',
    });
    expect(r.grossCents).toBe(Math.floor((100_000 * 10) / 31));
  });

  it('uses keyset iteration (listAfterId) across >1 batch when available', async () => {
    const tenantId = randomUUID();
    const repo = new KeysetStaffRepository();
    const staffService = new StaffService(repo);
    const hr = new StaffHrService(new InMemoryStaffHrStore(), staffService);
    const ids: string[] = [];
    for (let i = 0; i < 520; i += 1) {
      const s = await staffService.create(tenantId, {
        firstName: `K${i}`,
        lastName: 'Set',
        dateOfBirth: '1985-01-01',
        identityNumber: `KS-${i}-${randomUUID().slice(0, 6)}`,
        contactPhone: '+15550001',
        position: 'Teacher',
      });
      ids.push(s.id);
    }
    const run = await hr.exportPayroll(tenantId, { month: '2026-09' });
    expect(run.rows).toHaveLength(520);
    expect(new Set(run.rows.map((r) => r.staffId))).toEqual(new Set(ids));
    expect(repo.keysetCalls).toBe(2);
  });
});
