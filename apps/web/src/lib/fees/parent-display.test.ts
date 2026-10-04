import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHOOL_TIME_ZONE,
  formatMoney,
  formatSchoolDate,
  totalsByCurrency,
} from './parent-display';

describe('parent fee/library display helpers (PRC-L064)', () => {
  it('renders an 18:30Z due date as the next day in the school timezone', () => {
    // A UTC runner would show 30 Sep with ambient toLocaleDateString().
    expect(DEFAULT_SCHOOL_TIME_ZONE).toBe('Asia/Kolkata');
    expect(formatSchoolDate('2026-09-30T18:30:00Z', 'en-IN')).toBe('1 Oct 2026');
    expect(formatSchoolDate('2026-09-30T18:30:00Z', 'en-IN', 'UTC')).toBe('30 Sept 2026');
  });

  it('returns an empty string for an unparseable date instead of "Invalid Date"', () => {
    expect(formatSchoolDate('not-a-date', 'en-IN')).toBe('');
  });

  it('keeps balances in different currencies apart', () => {
    const totals = totalsByCurrency([
      { currency: 'INR', cents: 150_000 },
      { currency: 'USD', cents: 2_500 },
      { currency: 'inr', cents: 50_000 },
      { currency: 'AED', cents: 0 },
    ]);
    expect(totals).toEqual([
      { currency: 'INR', cents: 200_000 },
      { currency: 'USD', cents: 2_500 },
    ]);
    const [inr, usd] = totals.map((t) => formatMoney(t.cents, t.currency, 'en-IN'));
    expect(inr).toBe('₹2,000.00');
    expect(usd).toMatch(/\$25\.00$/);
  });

  it('does not invent a currency symbol when the record has none', () => {
    expect(formatMoney(12_345, '', 'en-IN')).toBe('123.45');
  });
});
