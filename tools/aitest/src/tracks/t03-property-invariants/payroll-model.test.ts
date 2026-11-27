import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  emptyPayrollModel,
  isWeekday,
  monthDates,
  oracleRun,
} from './payroll-model.js';

function model(
  proration: Parameters<typeof emptyPayrollModel>[0],
  divisor: Parameters<typeof emptyPayrollModel>[1],
) {
  const m = emptyPayrollModel(proration, divisor);
  m.staff.push({ id: 's1', grossCents: 3_100_000, offboardDate: null });
  return m;
}

describe('payroll oracle', () => {
  it('calendar helpers', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(monthDates('2026-04')).toHaveLength(30);
    expect(isWeekday('2026-01-03')).toBe(false); // Saturday
    expect(isWeekday('2026-01-05')).toBe(true);
  });

  it('full month without LOP pays the contract gross', () => {
    expect(oracleRun(model('calendar_days', 'calendar_days'), '2026-01')).toEqual([
      {
        staffId: 's1',
        grossCents: 3_100_000,
        deductionsCents: 0,
        netCents: 3_100_000,
        halfDays: 0,
      },
    ]);
  });

  it('LOP counts a date once at its highest weight (attendance and unpaid leave)', () => {
    const m = model('calendar_days', 'calendar_days');
    m.attendance.set(
      's1',
      new Map([
        ['2026-01-10', 'half_day'],
        ['2026-01-11', 'absent'],
      ]),
    );
    m.unpaidLeave.push({ staffId: 's1', start: '2026-01-10', end: '2026-01-11' });
    const [row] = oracleRun(m, '2026-01');
    // 2 LOP days x 3,100,000 / 31 = 200,000
    expect(row).toMatchObject({ halfDays: 4, deductionsCents: 200_000, netCents: 2_900_000 });
  });

  it('divisors: thirty and working days (weekends not charged)', () => {
    const thirty = model('calendar_days', 'thirty');
    thirty.attendance.set('s1', new Map([['2026-01-05', 'absent']]));
    expect(oracleRun(thirty, '2026-01')[0]!.deductionsCents).toBe(
      Math.round(3_100_000 / 30 / 100) * 100,
    );
    const working = model('calendar_days', 'working_days');
    working.attendance.set(
      's1',
      new Map([
        ['2026-01-03', 'absent'],
        ['2026-01-05', 'absent'],
      ]),
    );
    // Jan 2026 has 22 weekdays; only the Monday counts.
    expect(oracleRun(working, '2026-01')[0]).toMatchObject({
      halfDays: 2,
      deductionsCents: Math.round(3_100_000 / 22 / 100) * 100,
    });
  });

  it('offboarding: proration policies, LOP after the last day, exclusion', () => {
    const cal = model('calendar_days', 'calendar_days');
    cal.staff[0]!.offboardDate = '2026-01-10';
    cal.attendance.set('s1', new Map([['2026-01-20', 'absent']]));
    expect(oracleRun(cal, '2026-01')[0]).toMatchObject({
      grossCents: 1_000_000,
      deductionsCents: 0,
    });
    const work = model('working_days', 'calendar_days');
    work.staff[0]!.offboardDate = '2026-01-09'; // 7 of 22 weekdays
    expect(oracleRun(work, '2026-01')[0]!.grossCents).toBe(Math.floor((3_100_000 * 7) / 22));
    const full = model('full_month', 'calendar_days');
    full.staff[0]!.offboardDate = '2026-01-09';
    full.attendance.set('s1', new Map([['2026-01-20', 'absent']]));
    expect(oracleRun(full, '2026-01')[0]).toMatchObject({
      grossCents: 3_100_000,
      deductionsCents: 100_000,
    });
    expect(oracleRun(cal, '2026-02')).toEqual([]);
  });

  it('deductions never exceed gross and net = gross - deductions', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10_000_000 }),
        fc.array(
          fc.tuple(
            fc.integer({ min: 1, max: 28 }),
            fc.constantFrom('absent' as const, 'half_day' as const),
          ),
        ),
        fc.option(fc.integer({ min: 1, max: 28 }), { nil: null }),
        fc.constantFrom('calendar_days' as const, 'working_days' as const, 'full_month' as const),
        fc.constantFrom('calendar_days' as const, 'thirty' as const, 'working_days' as const),
        (gross, marks, last, proration, divisor) => {
          const m = emptyPayrollModel(proration, divisor);
          m.staff.push({
            id: 's',
            grossCents: gross,
            offboardDate: last ? `2026-02-${String(last).padStart(2, '0')}` : null,
          });
          m.attendance.set(
            's',
            new Map(marks.map(([d, k]) => [`2026-02-${String(d).padStart(2, '0')}`, k])),
          );
          const [row] = oracleRun(m, '2026-02');
          return (
            row !== undefined &&
            row.deductionsCents <= row.grossCents &&
            row.grossCents <= gross &&
            row.netCents === row.grossCents - row.deductionsCents
          );
        },
      ),
    );
  });
});
