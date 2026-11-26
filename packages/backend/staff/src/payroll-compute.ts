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

/**
 * PRC-M370 (DR37): loss-of-pay (LOP) rules, approved by the owner 2026-10-27.
 * - Per-day rate = monthly gross / divisor days. Divisor (config
 *   `PAYROLL_LOP_DIVISOR`): calendar days in the month (default), a flat 30,
 *   or the month's working (Mon-Fri) days.
 * - An absent day or an approved unpaid-leave day is 1 LOP day; a half day is 0.5.
 *   A date counts once, at its highest weight.
 * - Deduction = LOP days x per-day rate, applied to gross, rounded to the
 *   nearest rupee (100 minor units) and never above gross.
 */
export type PayrollLopDivisor = 'calendar_days' | 'thirty' | 'working_days';
export const PAYROLL_LOP_DIVISORS: readonly PayrollLopDivisor[] = [
  'calendar_days',
  'thirty',
  'working_days',
];
export const DEFAULT_PAYROLL_LOP_DIVISOR: PayrollLopDivisor = 'calendar_days';

/** Unset/blank -> `calendar_days`; `30` is accepted for `thirty`; unknown values throw. */
export function resolvePayrollLopDivisor(raw: string | undefined | null): PayrollLopDivisor {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return DEFAULT_PAYROLL_LOP_DIVISOR;
  if (value === '30') return 'thirty';
  if ((PAYROLL_LOP_DIVISORS as readonly string[]).includes(value)) {
    return value as PayrollLopDivisor;
  }
  throw new BusinessRuleError(
    `PAYROLL_LOP_DIVISOR must be one of ${PAYROLL_LOP_DIVISORS.join(', ')} or 30; got '${String(raw)}'`,
  );
}

/** A dated LOP event: `full` (absent / unpaid leave) or `half` (half day). */
export interface LopDay {
  date: string;
  weight: 'full' | 'half';
}

function isWeekday(iso: string): boolean {
  const dow = parseIsoDay(iso).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/**
 * Total LOP days for one staff member in `month` (YYYY-MM), counted in half days
 * so the value stays an integer: returns `{ halfDays, lopDays }`.
 * Under `working_days` only Mon-Fri dates count, matching that divisor.
 */
export function countLopDays(
  month: string,
  days: readonly LopDay[],
  divisor: PayrollLopDivisor = DEFAULT_PAYROLL_LOP_DIVISOR,
): { halfDays: number; lopDays: number } {
  const byDate = new Map<string, number>();
  for (const day of days) {
    if (!day.date.startsWith(`${month}-`)) continue;
    if (divisor === 'working_days' && !isWeekday(day.date)) continue;
    const weight = day.weight === 'full' ? 2 : 1;
    byDate.set(day.date, Math.max(byDate.get(day.date) ?? 0, weight));
  }
  let halfDays = 0;
  for (const weight of byDate.values()) halfDays += weight;
  return { halfDays, lopDays: halfDays / 2 };
}

/** Divisor days for `month` under the configured LOP divisor. */
export function lopDivisorDays(month: string, divisor: PayrollLopDivisor): number {
  const daysInMonth = calendarDaysInMonth(month);
  if (divisor === 'thirty') return 30;
  if (divisor === 'working_days') {
    return countDays(`${month}-01`, `${month}-${String(daysInMonth).padStart(2, '0')}`, true);
  }
  return daysInMonth;
}

/** LOP deduction in minor units: gross x (halfDays / 2) / divisorDays, nearest rupee, <= gross. */
export function lossOfPayDeductionCents(input: {
  monthlyGrossCents: number;
  halfDays: number;
  divisorDays: number;
}): number {
  const { monthlyGrossCents, halfDays, divisorDays } = input;
  if (
    !Number.isInteger(monthlyGrossCents) ||
    monthlyGrossCents < 0 ||
    !Number.isInteger(halfDays) ||
    halfDays < 0 ||
    !Number.isInteger(divisorDays) ||
    divisorDays <= 0
  ) {
    throw new BusinessRuleError('Invalid payroll deduction inputs');
  }
  if (monthlyGrossCents === 0 || halfDays === 0) return 0;
  const exact = (monthlyGrossCents * halfDays) / (2 * divisorDays);
  return Math.min(monthlyGrossCents, Math.round(exact / 100) * 100);
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
    `PAYROLL_PRORATION must be one of ${PAYROLL_PRORATION_POLICIES.join(', ')}; got '${String(raw)}'`,
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
