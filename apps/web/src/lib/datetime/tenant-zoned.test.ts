import { describe, expect, it } from 'vitest';
import { addDaysToIsoDate, todayInTimeZone, wallClockToUtcIso } from './tenant-zoned';

describe('wallClockToUtcIso (PRC-L047)', () => {
  it('interprets datetime-local in the tenant timezone, not the host timezone', () => {
    expect(wallClockToUtcIso('2026-01-10T17:00', 'Asia/Kolkata')).toBe('2026-01-10T11:30:00.000Z');
    expect(wallClockToUtcIso('2026-01-10T17:00', 'America/New_York')).toBe(
      '2026-01-10T22:00:00.000Z',
    );
  });

  it('handles DST transitions', () => {
    // 2026-07-01 is EDT (UTC-4).
    expect(wallClockToUtcIso('2026-07-01T09:00', 'America/New_York')).toBe(
      '2026-07-01T13:00:00.000Z',
    );
  });

  it('resolves date-only values to the end of the local day', () => {
    expect(wallClockToUtcIso('2026-01-10', 'Asia/Kolkata')).toBe('2026-01-10T18:29:59.000Z');
  });

  it('passes through values that already carry a zone', () => {
    expect(wallClockToUtcIso('2026-01-10T11:30:00.000Z', 'America/New_York')).toBe(
      '2026-01-10T11:30:00.000Z',
    );
  });

  it('falls back to Asia/Kolkata for an invalid timezone and rejects garbage', () => {
    expect(wallClockToUtcIso('2026-01-10T17:00', 'Not/AZone')).toBe('2026-01-10T11:30:00.000Z');
    expect(wallClockToUtcIso('tomorrow', 'Asia/Kolkata')).toBeNull();
  });
});

describe('todayInTimeZone (PRC-M078)', () => {
  it('is the IST calendar day at 01:30 IST although UTC is the previous day', () => {
    expect(todayInTimeZone('Asia/Kolkata', new Date('2026-09-29T20:00:00Z'))).toBe('2026-09-30');
  });
  it('is still the same day just before IST midnight', () => {
    expect(todayInTimeZone('Asia/Kolkata', new Date('2026-09-29T18:29:00Z'))).toBe('2026-09-29');
  });
  it('falls back to the default tenant zone for an invalid zone', () => {
    expect(todayInTimeZone('Not/AZone', new Date('2026-09-29T20:00:00Z'))).toBe('2026-09-30');
  });
  it('honours other zones', () => {
    expect(todayInTimeZone('America/New_York', new Date('2026-09-30T02:00:00Z'))).toBe(
      '2026-09-29',
    );
  });
});

describe('addDaysToIsoDate (PRC-M078)', () => {
  it('crosses month and year boundaries', () => {
    expect(addDaysToIsoDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToIsoDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToIsoDate('2026-09-30', -30)).toBe('2026-08-31');
  });
});
