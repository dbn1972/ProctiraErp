/**
 * PRC-M370 (DR37): half days and approved unpaid leave reduce pay.
 * Per-day rate = monthly gross / divisor days (calendar days by default, 30, or
 * working days). Half day = 0.5 LOP day, absent or approved unpaid leave = 1.
 * Deduction rounds to the nearest rupee.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import type { StaffLeaveEntity, StaffLeaveStatus, StaffLeaveType } from './leave-repository.js';
import * as compute from './payroll-compute.js';
import { StaffService } from './staff-service.js';

type Divisor = 'calendar_days' | 'thirty' | 'working_days';

function leave(
  staffId: string,
  startDate: string,
  endDate: string,
  leaveType: StaffLeaveType = 'unpaid',
  status: StaffLeaveStatus = 'approved',
): StaffLeaveEntity {
  return {
    id: randomUUID(),
    tenantId: 't',
    staffId,
    leaveType,
    startDate,
    endDate,
    reason: null,
    status,
    decidedBy: null,
    decidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function setup(opts: {
  monthlyGrossCents?: number;
  divisor?: Divisor;
  leaves?: (staffId: string) => StaffLeaveEntity[];
  offboardOn?: string;
}) {
  const tenantId = randomUUID();
  const staffService = new StaffService(new InMemoryStaffRepository());
  let staffId = '';
  const hr = new StaffHrService(new InMemoryStaffHrStore(), staffService, {
    lopDivisor: opts.divisor,
    unpaidLeaveSource: {
      listLeaves: async () => (opts.leaves ? opts.leaves(staffId) : []),
    },
  } as ConstructorParameters<typeof StaffHrService>[2]);
  const staff = await staffService.create(tenantId, {
    firstName: 'Lop',
    lastName: 'Rule',
    dateOfBirth: '1985-01-01',
    identityNumber: `LOP-${randomUUID().slice(0, 8)}`,
    contactPhone: '+15550001',
    position: 'Teacher',
  });
  staffId = staff.id;
  await hr.createContract(tenantId, {
    staffId,
    contractType: 'permanent',
    startDate: '2026-01-01',
    monthlyGrossCents: opts.monthlyGrossCents ?? 3_000_000,
  });
  if (opts.offboardOn) {
    await staffService.offboard(tenantId, staffId, { effectiveDate: opts.offboardOn }, 'hr-1');
  }
  const mark = (date: string, status: 'absent' | 'half_day' | 'present') =>
    hr.markAttendance(tenantId, { staffId, date, status }, 'hr-1');
  const run = async (month: string) => {
    const result = await hr.exportPayroll(tenantId, { month });
    return result.rows.find((r) => r.staffId === staffId)!;
  };
  return { mark, run };
}

describe('PRC-M370 loss-of-pay rules', () => {
  it('a half day deducts half a day (30-day month: 3,000,000 / 30 / 2 = 50,000)', async () => {
    const { mark, run } = await setup({});
    await mark('2026-09-02', 'half_day');
    const row = await run('2026-09');
    expect(row.deductionsCents).toBe(50_000);
    expect(row.netCents).toBe(2_950_000);
  });

  it('approved unpaid leave deducts every leave day inside the month', async () => {
    const { run } = await setup({
      leaves: (staffId) => [
        leave(staffId, '2026-09-10', '2026-09-11'),
        // Only 2026-09-30 is inside September.
        leave(staffId, '2026-09-30', '2026-10-02'),
      ],
    });
    const row = await run('2026-09');
    expect(row.deductionsCents).toBe(300_000);
  });

  it('paid, pending or rejected leave does not reduce pay', async () => {
    const { run } = await setup({
      leaves: (staffId) => [
        leave(staffId, '2026-09-10', '2026-09-11', 'annual'),
        leave(staffId, '2026-09-14', '2026-09-14', 'unpaid', 'pending'),
        leave(staffId, '2026-09-15', '2026-09-15', 'unpaid', 'rejected'),
      ],
    });
    expect((await run('2026-09')).deductionsCents).toBe(0);
  });

  it('a date counts once at its highest weight (absent inside an unpaid leave)', async () => {
    const { mark, run } = await setup({
      leaves: (staffId) => [leave(staffId, '2026-09-10', '2026-09-10')],
    });
    await mark('2026-09-10', 'half_day');
    await mark('2026-09-11', 'absent');
    expect((await run('2026-09')).deductionsCents).toBe(200_000);
  });

  it('LOP after the offboard date is not deducted again from the pro-rated pay', async () => {
    // Exit 2026-09-15 (calendar_days): gross 15/30 = 1,500,000. Unpaid leave 10th-30th
    // only counts 10th-15th (6 days x 100,000); the absent mark on the 20th is post-exit.
    const { mark, run } = await setup({
      offboardOn: '2026-09-15',
      leaves: (staffId) => [leave(staffId, '2026-09-10', '2026-09-30')],
    });
    await mark('2026-09-20', 'absent');
    const row = await run('2026-09');
    expect(row.grossCents).toBe(1_500_000);
    expect(row.deductionsCents).toBe(600_000);
    expect(row.netCents).toBe(900_000);
  });

  it('flat 30-day divisor in a 31-day month', async () => {
    const { mark, run } = await setup({ divisor: 'thirty' });
    await mark('2026-10-05', 'absent');
    expect((await run('2026-10')).deductionsCents).toBe(100_000);
  });

  it('working-day divisor (22 weekdays in 2026-09) rounds to the nearest rupee', async () => {
    const { mark, run } = await setup({ divisor: 'working_days' });
    await mark('2026-09-01', 'absent');
    // 3,000,000 / 22 = 136,363.6 minor units -> 136,400 (nearest rupee).
    expect((await run('2026-09')).deductionsCents).toBe(136_400);
  });

  it('calendar divisor rounds to the nearest rupee, not down', async () => {
    const { mark, run } = await setup({ monthlyGrossCents: 3_100_050 });
    await mark('2026-10-05', 'absent');
    // 3,100,050 / 31 = 100,001.6 -> 100,000.
    expect((await run('2026-10')).deductionsCents).toBe(100_000);
  });

  it('PAYROLL_LOP_DIVISOR resolves calendar_days by default, accepts 30, fails closed', () => {
    const resolve = (compute as unknown as { resolvePayrollLopDivisor: (raw?: string) => Divisor })
      .resolvePayrollLopDivisor;
    expect(resolve(undefined)).toBe('calendar_days');
    expect(resolve('30')).toBe('thirty');
    expect(resolve('working_days')).toBe('working_days');
    expect(() => resolve('weekly')).toThrow(/PAYROLL_LOP_DIVISOR/);
  });
});
