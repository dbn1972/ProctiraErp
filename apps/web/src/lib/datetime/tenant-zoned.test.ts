import { describe, expect, it } from 'vitest';
import { wallClockToUtcIso } from './tenant-zoned';

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
