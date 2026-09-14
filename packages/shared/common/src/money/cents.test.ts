/**
 * W2-FIN-08 / W1-DATA-09 money conversion unit tests.
 */
import { describe, expect, it } from 'vitest';

import { BusinessRuleError } from '../exceptions/index.js';
import {
  assertMajorMatchesCents,
  centsToMajorUnits,
  majorUnitsNumberFromCents,
  majorUnitsToCents,
  pgIntegerCents,
  pgNumericMajorToCents,
  pgOptionalIntegerCents,
} from './cents.js';

describe('W2-FIN-08 majorUnitsToCents', () => {
  it('converts common bank decimals without float drift', () => {
    expect(majorUnitsToCents(19.99)).toBe(1999);
    expect(majorUnitsToCents('19.99')).toBe(1999);
    expect(majorUnitsToCents(0.1)).toBe(10);
    expect(majorUnitsToCents(0.2)).toBe(20);
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

describe('W1-DATA-09 pgIntegerCents', () => {
  it('accepts pg INTEGER number, BIGINT string, and bigint', () => {
    expect(pgIntegerCents(12_500)).toBe(12_500);
    expect(pgIntegerCents('12500')).toBe(12_500);
    expect(pgIntegerCents(12_500n)).toBe(12_500);
    expect(pgIntegerCents(0)).toBe(0);
    expect(pgIntegerCents('-1')).toBe(-1);
  });

  it('rejects float money and unsafe BIGINT→Number coercion', () => {
    expect(() => pgIntegerCents(10.5)).toThrow(BusinessRuleError);
    expect(() => pgIntegerCents('10.5')).toThrow(BusinessRuleError);
    expect(() => pgIntegerCents('19.99')).toThrow(BusinessRuleError);
    expect(() => pgIntegerCents(Number.NaN)).toThrow(BusinessRuleError);
    expect(() => pgIntegerCents('9007199254740992')).toThrow(BusinessRuleError);
    expect(() => pgIntegerCents(9007199254740992n)).toThrow(BusinessRuleError);
    expect(() => pgIntegerCents(null)).toThrow(BusinessRuleError);
    expect(() => pgIntegerCents(undefined)).toThrow(BusinessRuleError);
  });

  it('maps SQL NULL via pgOptionalIntegerCents', () => {
    expect(pgOptionalIntegerCents(null)).toBeNull();
    expect(pgOptionalIntegerCents(undefined)).toBeNull();
    expect(pgOptionalIntegerCents('42')).toBe(42);
  });
});

describe('W1-DATA-09 pgNumericMajorToCents / majorUnitsNumberFromCents', () => {
  it('converts pg NUMERIC strings without Number()*100 Math.round', () => {
    expect(pgNumericMajorToCents('19.99')).toBe(1999);
    expect(pgNumericMajorToCents('1000.00')).toBe(100_000);
    expect(pgNumericMajorToCents(19.99)).toBe(1999);
  });

  it('rejects unsupported NUMERIC types and non-cent values', () => {
    expect(() => pgNumericMajorToCents(null)).toThrow(BusinessRuleError);
    expect(() => pgNumericMajorToCents('1.001')).toThrow(BusinessRuleError);
  });

  it('derives display major from cents', () => {
    expect(majorUnitsNumberFromCents(1999)).toBe(19.99);
    expect(majorUnitsNumberFromCents(100_000)).toBe(1000);
  });
});
