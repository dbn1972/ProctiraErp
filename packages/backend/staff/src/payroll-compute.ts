/**
 * W2-HR-01: payroll cents computation (gross / unpaid-absence deductions / net).
 */
import { BusinessRuleError, majorUnitsToCents } from '@proctira/common';

export function calendarDaysInMonth(month: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    throw new BusinessRuleError(`Payroll month must be YYYY-MM, got '${month}'`);
  }
  const year = Number(match[1]);
  const mon = Number(match[2]);
  if (mon < 1 || mon > 12) {
    throw new BusinessRuleError(`Payroll month must be YYYY-MM, got '${month}'`);
  }
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

/**
 * Resolve monthly gross cents from explicit contract field or numeric salary band.
 * Non-numeric bands (e.g. "L5") yield 0 — deductions stay 0 until gross is set.
 */
export function resolveMonthlyGrossCents(input: {
  monthlyGrossCents?: number | null;
  salaryBand?: string | null;
}): number {
  if (
    input.monthlyGrossCents != null &&
    Number.isInteger(input.monthlyGrossCents) &&
    input.monthlyGrossCents >= 0
  ) {
    return input.monthlyGrossCents;
  }
  const band = (input.salaryBand ?? '').trim();
  if (!band) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(band)) return 0;
  return majorUnitsToCents(band);
}

/** Unpaid absence deduction: floor(gross * absentDays / daysInMonth). */
export function unpaidAbsenceDeductionCents(
  monthlyGrossCents: number,
  absentDays: number,
  daysInMonth: number,
): number {
  if (
    !Number.isInteger(monthlyGrossCents) ||
    monthlyGrossCents < 0 ||
    !Number.isInteger(absentDays) ||
    absentDays < 0 ||
    !Number.isInteger(daysInMonth) ||
    daysInMonth <= 0
  ) {
    throw new BusinessRuleError('Invalid payroll deduction inputs');
  }
  if (monthlyGrossCents === 0 || absentDays === 0) return 0;
  return Math.floor((monthlyGrossCents * absentDays) / daysInMonth);
}

export function assertPayrollRowBalanced(row: {
  grossCents: number;
  deductionsCents: number;
  netCents: number;
}): void {
  if (row.netCents !== row.grossCents - row.deductionsCents) {
    throw new BusinessRuleError(
      `Payroll row unbalanced: net ${row.netCents} <> gross ${row.grossCents} - deductions ${row.deductionsCents}`,
    );
  }
  if (row.deductionsCents > row.grossCents) {
    throw new BusinessRuleError('Payroll deductions cannot exceed gross');
  }
}
