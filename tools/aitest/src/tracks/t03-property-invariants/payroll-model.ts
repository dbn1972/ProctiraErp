/**
 * Payroll oracle (pure), written from the documented rules, not by calling
 * payroll-compute.ts, so a regression in the implementation is caught:
 *
 * - PRC-H089 proration for staff offboarded inside the month:
 *   calendar_days: floor(gross x calendar days up to last day / days in month);
 *   working_days: same with Mon-Fri days; full_month: full gross.
 *   Offboarded before the month starts: not in the run.
 * - PRC-M370 (DR37) loss of pay: absent or approved unpaid-leave day = 1 LOP
 *   day, half day = 0.5; a date counts once at its highest weight; under
 *   working_days only Mon-Fri dates count; divisor calendar days / 30 /
 *   Mon-Fri days; deduction = LOP days x full-month gross / divisor, rounded to
 *   the nearest rupee (100 paise), never above gross; LOP after the last day
 *   is not charged when proration already stops pay there.
 * - W2-HR-01: net = gross - deductions per row; run totals and the payroll
 *   trial balance (salary expense = deductions + wages payable) balance.
 */
import { COMMON_INVARIANTS, type InvariantMeta } from './core.js';

export type Proration = 'calendar_days' | 'working_days' | 'full_month';
export type Divisor = 'calendar_days' | 'thirty' | 'working_days';
export type Mark = 'present' | 'absent' | 'half_day' | 'leave';

export interface MStaff {
  id: string;
  grossCents: number;
  offboardDate: string | null;
}

export interface PayrollModel {
  staff: MStaff[];
  /** staffId -> date -> last mark */
  attendance: Map<string, Map<string, Mark>>;
  /** approved unpaid leave, inclusive */
  unpaidLeave: Array<{ staffId: string; start: string; end: string }>;
  /** month -> current posted run id */
  posted: Map<string, string>;
  proration: Proration;
  divisor: Divisor;
}

export function emptyPayrollModel(proration: Proration, divisor: Divisor): PayrollModel {
  return {
    staff: [],
    attendance: new Map(),
    unpaidLeave: [],
    posted: new Map(),
    proration,
    divisor,
  };
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m, 0)).getUTCDate();
}

export function isWeekday(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6;
}

export function monthDates(month: string): string[] {
  return Array.from(
    { length: daysInMonth(month) },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
}

export interface OracleRow {
  staffId: string;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  halfDays: number;
}

/** Expected payroll rows for `month`, or the reason a staff member is absent from the run. */
export function oracleRun(m: PayrollModel, month: string): OracleRow[] {
  const dates = monthDates(month);
  const start = dates[0]!;
  const end = dates.at(-1)!;
  const rows: OracleRow[] = [];
  for (const s of m.staff) {
    if (s.offboardDate !== null && s.offboardDate < start) continue;
    const last = s.offboardDate;
    let gross = s.grossCents;
    if (m.proration !== 'full_month' && last !== null && last < end) {
      const count = (ds: string[]) =>
        m.proration === 'working_days' ? ds.filter(isWeekday).length : ds.length;
      const eligible = count(dates.filter((d) => d <= last));
      const period = count(dates);
      gross = period === 0 ? 0 : Math.floor((s.grossCents * eligible) / period);
    }
    const cutoff = m.proration !== 'full_month' && last !== null && last < end ? last : null;
    const weight = new Map<string, number>();
    const bump = (d: string, w: number) => {
      if (!d.startsWith(`${month}-`)) return;
      if (cutoff !== null && d > cutoff) return;
      if (m.divisor === 'working_days' && !isWeekday(d)) return;
      weight.set(d, Math.max(weight.get(d) ?? 0, w));
    };
    for (const [d, mark] of m.attendance.get(s.id) ?? []) {
      if (mark === 'absent') bump(d, 2);
      if (mark === 'half_day') bump(d, 1);
    }
    for (const l of m.unpaidLeave.filter((x) => x.staffId === s.id)) {
      for (const d of dates) if (d >= l.start && d <= l.end) bump(d, 2);
    }
    const halfDays = [...weight.values()].reduce((a, b) => a + b, 0);
    const div =
      m.divisor === 'thirty'
        ? 30
        : m.divisor === 'working_days'
          ? dates.filter(isWeekday).length
          : dates.length;
    let ded = 0;
    if (s.grossCents > 0 && halfDays > 0) {
      const exact = (s.grossCents * halfDays) / (2 * div);
      ded = Math.min(s.grossCents, Math.round(exact / 100) * 100);
    }
    ded = Math.min(gross, ded);
    rows.push({
      staffId: s.id,
      grossCents: gross,
      deductionsCents: ded,
      netCents: gross - ded,
      halfDays,
    });
  }
  return rows;
}

export const PAYROLL_INVARIANTS: InvariantMeta[] = [
  {
    id: 'net-equals-gross-minus-deductions',
    title: 'Payslip net equals gross minus deductions (rows and run totals)',
    module: 'staff-payroll',
    category: 'money',
    severity: 'critical',
    source: 'BRIEF; W2-HR-01 assertPayrollRowBalanced',
  },
  {
    id: 'deductions-within-gross',
    title: 'Deductions never exceed gross and gross never exceeds the contract monthly gross',
    module: 'staff-payroll',
    category: 'money',
    severity: 'high',
    source: 'PRC-M370 never above gross; PRC-H089 proration <= monthly gross',
  },
  {
    id: 'proration-matches-policy',
    title: 'Gross for an offboarded staff member follows the configured proration policy',
    module: 'staff-payroll',
    category: 'money',
    severity: 'high',
    source: 'PRC-H089 PAYROLL_PRORATION',
  },
  {
    id: 'lop-matches-policy',
    title: 'Loss-of-pay deduction follows DR37 (weights, divisor, nearest rupee)',
    module: 'staff-payroll',
    category: 'money',
    severity: 'high',
    source: 'PRC-M370 (DR37) PAYROLL_LOP_DIVISOR',
  },
  {
    id: 'no-double-lop',
    title: 'A LOP date is charged once, even when attendance and unpaid leave both cover it',
    module: 'staff-payroll',
    category: 'money',
    severity: 'high',
    source: 'BRIEF; PRC-M370 a date counts once at its highest weight',
  },
  {
    id: 'run-totals-balance',
    title: 'Stored run totals equal the sum of its payslips and the payroll trial balance balances',
    module: 'staff-payroll',
    category: 'money',
    severity: 'high',
    source: 'W2-HR-01 trial balance; staff_payroll_runs totals',
  },
  {
    id: 'posted-once-per-month',
    title: 'At most one current posted run per month; replace reverses the previous run',
    module: 'staff-payroll',
    category: 'money',
    severity: 'critical',
    source: 'PRC-M207 / db/sql/246; PRC-M368; reverse-and-replace',
  },
  {
    id: 'idempotent-repost',
    title: 'Re-posting a posted month returns the stored run unchanged',
    module: 'staff-payroll',
    category: 'money',
    severity: 'medium',
    source: 'PRC-M369 store is authoritative',
  },
  {
    id: 'eligibility',
    title:
      'The run pays active staff and staff offboarded on or after the month start, nobody else',
    module: 'staff-payroll',
    category: 'money',
    severity: 'high',
    source: 'PRC-H089 listPayrollEligibleStaff',
  },
  ...COMMON_INVARIANTS('staff-payroll'),
];
