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

/**
 * PRC-H089: pro-rata policy for staff offboarded mid-month.
 * - calendar_days: gross × (calendar days up to and including the offboard date) / days in month
 * - working_days:  gross × (Mon–Fri days up to the offboard date) / Mon–Fri days in month
 * - full_month:    full gross regardless of the offboard date
 */
export type PayrollProrationPolicy = 'calendar_days' | 'working_days' | 'full_month';

export const PAYROLL_PRORATION_POLICIES: readonly PayrollProrationPolicy[] = [
  'calendar_days',
  'working_days',
  'full_month',
];

export const DEFAULT_PAYROLL_PRORATION: PayrollProrationPolicy = 'calendar_days';

/**
 * Resolve the `PAYROLL_PRORATION` config value. Unset/blank → `calendar_days`.
 * An unknown value fails closed (throws) so a typo never silently pays a full month.
 */
export function resolvePayrollProrationPolicy(
  raw: string | undefined | null,
): PayrollProrationPolicy {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return DEFAULT_PAYROLL_PRORATION;
  if ((PAYROLL_PRORATION_POLICIES as readonly string[]).includes(value)) {
    return value as PayrollProrationPolicy;
  }
  throw new BusinessRuleError(
    `PAYROLL_PRORATION must be one of ${PAYROLL_PRORATION_POLICIES.join(', ')}; got '${raw}'`,
  );
}

function parseIsoDay(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new BusinessRuleError(`Expected YYYY-MM-DD, got '${iso}'`);
  }
  return new Date(`${iso}T00:00:00.000Z`);
}

function countDays(from: string, to: string, weekdaysOnly: boolean): number {
  const start = parseIsoDay(from);
  const end = parseIsoDay(to);
  let n = 0;
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const dow = d.getUTCDay();
    if (!weekdaysOnly || (dow !== 0 && dow !== 6)) n += 1;
  }
  return n;
}

export interface PayrollProration {
  policy: PayrollProrationPolicy;
  /** Days paid under the policy's unit (calendar or working days). */
  eligibleDays: number;
  /** Days in the month under the policy's unit. */
  periodDays: number;
  grossCents: number;
}

/**
 * Pro-rate a monthly gross for a staff member whose last working day (`lastDay`, inclusive)
 * falls inside `[monthStart, monthEnd]`. A null/after-month `lastDay` pays the full gross.
 */
export function prorateMonthlyGrossCents(input: {
  monthlyGrossCents: number;
  policy: PayrollProrationPolicy;
  monthStart: string;
  monthEnd: string;
  lastDay: string | null;
}): PayrollProration {
  const { monthlyGrossCents, policy, monthStart, monthEnd, lastDay } = input;
  if (!Number.isInteger(monthlyGrossCents) || monthlyGrossCents < 0) {
    throw new BusinessRuleError('Invalid payroll gross for proration');
  }
  const weekdaysOnly = policy === 'working_days';
  const periodDays = countDays(monthStart, monthEnd, weekdaysOnly);
  if (policy === 'full_month' || !lastDay || lastDay >= monthEnd) {
    return { policy, eligibleDays: periodDays, periodDays, grossCents: monthlyGrossCents };
  }
  if (lastDay < monthStart) {
    return { policy, eligibleDays: 0, periodDays, grossCents: 0 };
  }
  const eligibleDays = countDays(monthStart, lastDay, weekdaysOnly);
  const grossCents =
    periodDays === 0 ? 0 : Math.floor((monthlyGrossCents * eligibleDays) / periodDays);
  return { policy, eligibleDays, periodDays, grossCents };
}
