/** PRC-M095: major-unit entry -> integer minor units, and currency display. */
import { describe, expect, it } from 'vitest';
import { formatMoney, parseMajorUnits } from './format-money';

describe('parseMajorUnits', () => {
  it('converts rupees to paise without float error', () => {
    expect(parseMajorUnits('5000.00')).toBe(500000);
    expect(parseMajorUnits('5,000.5')).toBe(500050);
    expect(parseMajorUnits('0.29')).toBe(29);
  });
  it('rejects blank, negative and malformed input', () => {
    for (const bad of ['', '  ', '-5', 'abc', '1.234', '1e3']) {
      expect(parseMajorUnits(bad)).toBeNull();
    }
  });
});

describe('formatMoney', () => {
  it('shows ₹5,000.00 for 500000 paise', () => {
    expect(formatMoney(500000, 'INR')).toBe('₹5,000.00');
  });
});
