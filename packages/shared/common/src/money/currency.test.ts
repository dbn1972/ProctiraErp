import { describe, it, expect } from 'vitest';

import { BusinessRuleError } from '../exceptions/index.js';
import {
  DEFAULT_CURRENCY,
  assertIso4217Code,
  currencyForCountry,
  isIso4217Code,
} from './currency.js';

describe('Decision D1 currency helper', () => {
  it('defaults the platform currency to INR', () => {
    expect(DEFAULT_CURRENCY).toBe('INR');
  });

  it('resolves India to INR via the country→currency path', () => {
    expect(currencyForCountry('IN')).toBe('INR');
    expect(currencyForCountry('in')).toBe('INR');
    expect(currencyForCountry(' IN ')).toBe('INR');
  });

  it('falls back to INR for unknown/empty countries', () => {
    expect(currencyForCountry('US')).toBe('INR');
    expect(currencyForCountry('')).toBe('INR');
    expect(currencyForCountry(undefined)).toBe('INR');
    expect(currencyForCountry(null)).toBe('INR');
  });

  it('accepts valid ISO-4217 codes', () => {
    expect(isIso4217Code('INR')).toBe(true);
    expect(assertIso4217Code('INR')).toBe('INR');
  });

  it('rejects invalid currency codes', () => {
    for (const bad of ['usd', '', 'US', 'DOLLAR', 'in', 'IN']) {
      expect(() => assertIso4217Code(bad)).toThrow(BusinessRuleError);
      expect(isIso4217Code(bad)).toBe(false);
    }
  });
});
