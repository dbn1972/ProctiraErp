/**
 * PRC-M228 — cron step ranges, day-of-month / day-of-week semantics (Vixie OR),
 * weekday 7, range validation and timezone evaluation.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  PipelineScheduler,
  cronMatchesDate,
  getNextRunTime,
  isValidCronExpression,
  parseCronField,
} from './pipeline-scheduler.js';

const at = (iso: string) => new Date(iso);

describe('cron field parsing (PRC-M228)', () => {
  it.each([
    ['*/15', 0, 59, [0, 15, 30, 45]],
    ['10-20/5', 0, 59, [10, 15, 20]],
    ['5/20', 0, 59, [5, 25, 45]],
    ['1,3-4,10-12/2', 1, 12, [1, 3, 4, 10, 12]],
    ['0-6/3', 0, 7, [0, 3, 6]],
  ])('%s → %j', (field, min, max, expected) => {
    expect([...parseCronField(field, min, max)!].sort((a, b) => a - b)).toEqual(expected);
  });

  it.each([
    '60 * * * *',
    '* 24 * * *',
    '* * 0 * *',
    '* * 32 * *',
    '* * * 13 *',
    '* * * * 8',
    '20-10 * * * *',
    '*/0 * * * *',
    'abc',
    '* * * *',
  ])('rejects %s', (expr) => {
    expect(isValidCronExpression(expr)).toBe(false);
  });
});

describe('cron matching (PRC-M228)', () => {
  // Expected next fire time after the reference instant (UTC).
  const table: Array<[string, string, string]> = [
    // step ranges are bounded by the range end
    ['10-20/5 * * * *', '2026-01-01T00:20:30Z', '2026-01-01T01:10:00Z'],
    ['*/15 * * * *', '2026-01-01T00:16:00Z', '2026-01-01T00:30:00Z'],
    // weekday 7 == Sunday (2026-01-04 is a Sunday)
    ['0 9 * * 7', '2026-01-01T00:00:00Z', '2026-01-04T09:00:00Z'],
    ['0 9 * * 0', '2026-01-01T00:00:00Z', '2026-01-04T09:00:00Z'],
    // both day fields restricted → OR: 15th OR Monday (2026-01-05 is Monday)
    ['0 0 15 * 1', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z'],
    // only dom restricted → dom must match
    ['0 0 15 * *', '2026-01-01T00:00:00Z', '2026-01-15T00:00:00Z'],
    // dow restricted, dom `*` → dow must match (Friday 2026-01-02)
    ['30 6 * * 5', '2026-01-01T00:00:00Z', '2026-01-02T06:30:00Z'],
    // dom with step starting `*` counts as unrestricted → AND with dow
    ['0 0 */2 * 1', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z'],
    ['@monthly', '2026-01-15T00:00:00Z', '2026-02-01T00:00:00Z'],
    ['@weekly', '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z'],
    ['0 12 29 2 *', '2026-03-01T00:00:00Z', '2028-02-29T12:00:00Z'],
  ];

  it.each(table)('%s after %s → %s', (expr, after, expected) => {
    if (expected.startsWith('2028')) {
      // beyond the 366-day search window → null, and the date itself matches
      expect(getNextRunTime(expr, at(after))).toBeNull();
      expect(cronMatchesDate(expr, at(expected))).toBe(true);
      return;
    }
    expect(getNextRunTime(expr, at(after))?.toISOString()).toBe(at(expected).toISOString());
  });

  it('evaluates in the configured IANA timezone', () => {
    // 09:00 in Asia/Kolkata (UTC+5:30) is 03:30 UTC.
    expect(
      getNextRunTime('0 9 * * *', at('2026-01-01T00:00:00Z'), 'Asia/Kolkata')?.toISOString(),
    ).toBe('2026-01-01T03:30:00.000Z');
    // New York: 09:00 EST (UTC-5) in January, 09:00 EDT (UTC-4) in July.
    expect(
      getNextRunTime('0 9 * * *', at('2026-01-10T00:00:00Z'), 'America/New_York')?.toISOString(),
    ).toBe('2026-01-10T14:00:00.000Z');
    expect(
      getNextRunTime('0 9 * * *', at('2026-07-10T00:00:00Z'), 'America/New_York')?.toISOString(),
    ).toBe('2026-07-10T13:00:00.000Z');
  });

  it('scheduler uses its timezone and rejects unknown zones', () => {
    const s = new PipelineScheduler({ timezone: 'Asia/Kolkata' });
    const entry = s.registerSchedule('p1', 't1', '0 9 * * *');
    const next = entry.nextRunAt!;
    expect(next.getUTCHours() * 60 + next.getUTCMinutes()).toBe(3 * 60 + 30);
    expect(() => new PipelineScheduler({ timezone: 'Mars/Olympus' })).toThrow();
  });

  it('property: next run matches and no earlier minute matches', () => {
    const field = (min: number, max: number) =>
      fc.oneof(
        fc.constant('*'),
        fc.integer({ min, max }).map(String),
        fc
          .tuple(fc.integer({ min, max }), fc.integer({ min, max }), fc.integer({ min: 1, max: 9 }))
          .map(([a, b, st]) => `${Math.min(a, b)}-${Math.max(a, b)}/${st}`),
        fc.integer({ min: 1, max: 9 }).map((st) => `*/${st}`),
      );
    fc.assert(
      fc.property(
        field(0, 59),
        field(0, 23),
        field(1, 28),
        fc.constant('*'),
        field(0, 7),
        fc.integer({ min: 0, max: 365 * 24 * 60 }),
        (mi, h, dom, mo, dow, offsetMin) => {
          const expr = `${mi} ${h} ${dom} ${mo} ${dow}`;
          expect(isValidCronExpression(expr)).toBe(true);
          const after = new Date(Date.UTC(2026, 0, 1) + offsetMin * 60_000);
          const next = getNextRunTime(expr, after);
          if (!next) return;
          expect(cronMatchesDate(expr, next)).toBe(true);
          // spot-check the minutes just before `next` (bounded for speed)
          const probe = new Date(next.getTime());
          for (let i = 0; i < 90; i++) {
            probe.setUTCMinutes(probe.getUTCMinutes() - 1);
            if (probe <= after) break;
            expect(cronMatchesDate(expr, probe)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
