import { describe, it, expect } from 'vitest';

import { reviveDates } from '../revive-dates.js';

describe('reviveDates', () => {
  it('revives ISO date strings to Date instances', () => {
    const iso = '2024-06-15T10:30:00.000Z';
    const revived = reviveDates({ createdAt: iso, updatedAt: iso });

    expect(revived.createdAt).toBeInstanceOf(Date);
    expect(revived.updatedAt).toBeInstanceOf(Date);
    expect(revived.createdAt.toISOString()).toBe(iso);
  });

  it('leaves existing Date instances unchanged', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    const revived = reviveDates({ at: date });

    expect(revived.at).toBe(date);
    expect(revived.at.toISOString()).toBe(date.toISOString());
  });

  it('passes through null and undefined', () => {
    expect(reviveDates(null)).toBeNull();
    expect(reviveDates(undefined)).toBeUndefined();
    expect(reviveDates({ reviewedAt: null })).toEqual({ reviewedAt: null });
  });

  it('does not revive non-date strings', () => {
    expect(reviveDates('2024-06-15')).toBe('2024-06-15');
    expect(reviveDates({ code: 'SCH-001' })).toEqual({ code: 'SCH-001' });
  });

  it('revives nested arrays and objects', () => {
    const iso = '2024-06-15T10:30:00.000Z';
    const revived = reviveDates({
      data: [{ createdAt: iso }],
      meta: { generatedAt: iso },
    });

    expect(revived.data[0]!.createdAt).toBeInstanceOf(Date);
    expect(revived.meta.generatedAt).toBeInstanceOf(Date);
  });
});
