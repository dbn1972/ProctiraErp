import { describe, it, expect } from 'vitest';

import { reviveDates } from '../revive-dates.js';

describe('reviveDates', () => {
  it('revives the entity timestamp keys after a JSON round-trip', () => {
    const iso = '2024-06-15T10:30:00.000Z';
    const revived = reviveDates(
      JSON.parse(JSON.stringify({ createdAt: new Date(iso), updatedAt: iso })),
    );

    expect(revived.createdAt).toBeInstanceOf(Date);
    expect(revived.updatedAt).toBeInstanceOf(Date);
    expect(revived.createdAt.toISOString()).toBe(iso);
  });

  it('leaves existing Date instances unchanged and returns the same reference', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    const value = { createdAt: date, updatedAt: date };
    const revived = reviveDates(value);

    expect(revived).toBe(value);
    expect(revived.createdAt).toBe(date);
  });

  it('passes through null, undefined and null-valued keys', () => {
    expect(reviveDates(null)).toBeNull();
    expect(reviveDates(undefined)).toBeUndefined();
    expect(reviveDates({ reviewedAt: null }, ['reviewedAt'])).toEqual({ reviewedAt: null });
  });

  it('does not touch timestamps inside opaque JSON or non-listed keys', () => {
    const iso = '2024-06-15T10:30:00.000Z';
    const revived = reviveDates({
      code: 'SCH-001',
      startDate: '2024-06-15',
      metadata: { generatedAt: iso },
      submittedAt: iso,
    });

    expect(revived.metadata.generatedAt).toBe(iso);
    expect(revived.submittedAt).toBe(iso);
    expect(revived.startDate).toBe('2024-06-15');
  });

  it('revives custom keys and maps over arrays', () => {
    const iso = '2024-06-15T10:30:00.000Z';
    const revived = reviveDates(
      [{ submittedAt: iso, createdAt: iso }],
      ['submittedAt', 'createdAt'],
    );

    expect(revived[0]!.submittedAt).toBeInstanceOf(Date);
    expect(revived[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('leaves unparseable strings alone', () => {
    expect(reviveDates({ createdAt: 'not-a-date' })).toEqual({ createdAt: 'not-a-date' });
  });
});
