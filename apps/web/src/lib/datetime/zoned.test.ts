import { describe, expect, it } from 'vitest';
import { formatInTimeZone, zonedLocalToUtcIso } from './zoned';
import { createInterviewSlotFormSchema } from '../admissions/validation';

describe('zonedLocalToUtcIso (PRC-L233)', () => {
  it('interprets a datetime-local value in the tenant timezone, not the runtime one', () => {
    expect(zonedLocalToUtcIso('2026-06-01T10:00', 'Asia/Kolkata')).toBe('2026-06-01T04:30:00.000Z');
    expect(zonedLocalToUtcIso('2026-01-15T09:00', 'UTC')).toBe('2026-01-15T09:00:00.000Z');
  });

  it('resolves DST-observing zones with the offset in force', () => {
    expect(zonedLocalToUtcIso('2026-07-01T12:00', 'America/New_York')).toBe(
      '2026-07-01T16:00:00.000Z',
    );
    expect(zonedLocalToUtcIso('2026-01-01T12:00', 'America/New_York')).toBe(
      '2026-01-01T17:00:00.000Z',
    );
  });

  it('returns null instead of throwing for blank or malformed input', () => {
    expect(zonedLocalToUtcIso('', 'Asia/Kolkata')).toBeNull();
    expect(zonedLocalToUtcIso('not-a-date')).toBeNull();
    expect(() => zonedLocalToUtcIso('')).not.toThrow();
  });

  it('formats an instant in the tenant timezone', () => {
    const out = formatInTimeZone('2026-06-01T04:30:00.000Z', 'Asia/Kolkata', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    expect(out).toContain('10:00');
    expect(formatInTimeZone('garbage', 'UTC')).toBe('—');
  });
});

describe('createInterviewSlotFormSchema (PRC-L233)', () => {
  const base = {
    institutionId: '11111111-1111-4111-8111-111111111111',
    startsAt: '2026-06-01T04:30:00.000Z',
    endsAt: '2026-06-01T05:00:00.000Z',
    capacity: 2,
  };
  it('accepts a valid slot', () => {
    expect(createInterviewSlotFormSchema.safeParse(base).success).toBe(true);
  });
  it('rejects end <= start and capacity < 1', () => {
    expect(
      createInterviewSlotFormSchema.safeParse({ ...base, endsAt: base.startsAt }).success,
    ).toBe(false);
    expect(createInterviewSlotFormSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
  });
});
