/**
 * W2-FIN-08 money conversion unit tests.
 */
import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@proctira/common';

import {
  assertMajorMatchesCents,
  centsToMajorUnits,
  majorUnitsToCents,
} from './cents.js';

describe('W2-FIN-08 majorUnitsToCents', () => {
  it('converts common bank decimals without float drift', () => {
    expect(majorUnitsToCents(19.99)).toBe(1999);
    expect(majorUnitsToCents('19.99')).toBe(1999);
    expect(majorUnitsToCents(0.1)).toBe(10);
    expect(majorUnitsToCents(0.2)).toBe(20);
    // Classic IEEE trap: Number(0.1 + 0.2) === 0.30000000000000004
    expect(majorUnitsToCents(0.1 + 0.2)).toBe(30);
    expect(majorUnitsToCents(1000)).toBe(100_000);
    expect(majorUnitsToCents('1000.00')).toBe(100_000);
  });

  it('rejects non-cent-representable and non-finite values', () => {
    expect(() => majorUnitsToCents('1.001')).toThrow(BusinessRuleError);
    expect(() => majorUnitsToCents(1 / 3)).toThrow(BusinessRuleError);
    expect(() => majorUnitsToCents(Number.NaN)).toThrow(BusinessRuleError);
    expect(() => majorUnitsToCents(Number.POSITIVE_INFINITY)).toThrow(BusinessRuleError);
    expect(() => majorUnitsToCents(-5)).toThrow(BusinessRuleError);
    expect(() => majorUnitsToCents('abc')).toThrow(BusinessRuleError);
  });

  it('round-trips cents ↔ major for reconciliation', () => {
    expect(centsToMajorUnits(1999)).toBe('19.99');
    expect(centsToMajorUnits(30)).toBe('0.30');
    assertMajorMatchesCents(19.99, 1999);
    expect(() => assertMajorMatchesCents(19.99, 2000)).toThrow(BusinessRuleError);
  });
});
