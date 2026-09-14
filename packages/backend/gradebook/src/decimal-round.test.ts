import { describe, expect, it } from 'vitest';

import { roundDecimal, roundRatio } from './decimal-round.js';

describe('roundDecimal (HALF_UP)', () => {
  it('avoids classic float drift at half increments', () => {
    expect(roundDecimal(2.675, 2)).toBe(2.68);
    expect(roundDecimal(1.005, 2)).toBe(1.01);
    expect(roundDecimal(0.015, 2)).toBe(0.02);
  });

  it('rounds GPA-style repeating decimals deterministically', () => {
    expect(roundDecimal(19 / 3, 3)).toBe(6.333);
    expect(roundDecimal(28 / 3, 3)).toBe(9.333);
  });

  it('preserves already-rounded values', () => {
    expect(roundDecimal(6.333, 3)).toBe(6.333);
    expect(roundDecimal(9.5, 1)).toBe(9.5);
    expect(roundDecimal(7, 3)).toBe(7);
  });
});

describe('roundDecimal (HALF_EVEN / banker)', () => {
  it('rounds halves to the nearest even digit', () => {
    expect(roundDecimal(2.5, 0, 'HALF_EVEN')).toBe(2);
    expect(roundDecimal(3.5, 0, 'HALF_EVEN')).toBe(4);
    expect(roundDecimal(2.675, 2, 'HALF_EVEN')).toBe(2.68);
    expect(roundDecimal(2.665, 2, 'HALF_EVEN')).toBe(2.66);
  });
});

describe('roundRatio (HALF_UP)', () => {
  it('rounds rational GPA averages without float drift', () => {
    expect(roundRatio(10 + 9 + 0, 3, 3)).toBe(6.333);
    expect(roundRatio(10 * 1 + 9 * 2 + 0 * 1, 1 + 2 + 1, 3)).toBe(7);
    expect(roundRatio(10 + 9, 2, 3)).toBe(9.5);
  });

  it('rounds partial-credit ratios deterministically', () => {
    expect(roundRatio(4 * 50, 100, 2)).toBe(2);
    expect(roundRatio(3 * 1, 6, 2)).toBe(0.5);
    expect(roundRatio(1 * 1, 6, 2)).toBe(0.17);
  });

  it('corrects float drift that naive Math.round misses', () => {
    const naive = Math.round(1.005 * 100) / 100;
    expect(naive).toBe(1);
    expect(roundRatio(1005, 1000, 2)).toBe(1.01);
    expect(roundRatio(2675, 1000, 2)).toBe(2.68);
  });
});
