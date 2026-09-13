/**
 * W2-HR-01 payroll compute unit tests.
 */
import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@proctira/common';

import {
  assertPayrollRowBalanced,
  calendarDaysInMonth,
  resolveMonthlyGrossCents,
  unpaidAbsenceDeductionCents,
} from './payroll-compute.js';

describe('W2-HR-01 payroll compute', () => {
  it('resolves gross from monthlyGrossCents or numeric salary band', () => {
    expect(resolveMonthlyGrossCents({ monthlyGrossCents: 50_000 })).toBe(50_000);
    expect(resolveMonthlyGrossCents({ salaryBand: '1000.50' })).toBe(100_050);
    expect(resolveMonthlyGrossCents({ salaryBand: 'L5' })).toBe(0);
  });

  it('computes unpaid absence deductions in integer cents', () => {
    const days = calendarDaysInMonth('2026-09');
    expect(days).toBe(30);
    // 30000 * 3 / 30 = 3000
    expect(unpaidAbsenceDeductionCents(30_000, 3, days)).toBe(3_000);
    expect(unpaidAbsenceDeductionCents(30_000, 0, days)).toBe(0);
    expect(unpaidAbsenceDeductionCents(0, 5, days)).toBe(0);
  });

  it('enforces net = gross - deductions', () => {
    assertPayrollRowBalanced({
      grossCents: 30_000,
      deductionsCents: 3_000,
      netCents: 27_000,
    });
    expect(() =>
      assertPayrollRowBalanced({
        grossCents: 30_000,
        deductionsCents: 3_000,
        netCents: 26_000,
      }),
    ).toThrow(BusinessRuleError);
  });
});
