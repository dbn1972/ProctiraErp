import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_TIMEZONE,
  formatAdmissionNumber,
  offerFeeAmountCents,
  resolveTenantTimeZone,
  tenantLocalDate,
} from './admissions-offer-policy.js';

describe('PRC-L002 admissions offer money and calendar rules', () => {
  it('converts fee amounts with majorUnitsToCents rules', () => {
    expect(offerFeeAmountCents(1500)).toBe(150000);
    expect(offerFeeAmountCents(10.05)).toBe(1005);
    expect(offerFeeAmountCents('10.05')).toBe(1005);
    // Sub-cent amounts are rejected rather than float-rounded.
    expect(() => offerFeeAmountCents(10.005)).toThrow(/cents/);
    expect(() => offerFeeAmountCents(-1)).toThrow();
    expect(() => offerFeeAmountCents(Number.NaN)).toThrow();
  });

  it('uses the tenant-local calendar at the IST year boundary', () => {
    const clock = new Date('2026-12-31T19:00:00.000Z'); // 2027-01-01 00:30 IST
    expect(tenantLocalDate(clock, 'Asia/Kolkata')).toBe('2027-01-01');
    expect(formatAdmissionNumber(clock, 'Asia/Kolkata', 7)).toBe('ADM-2027-0007');
    // Default timezone (missing/invalid tenant config) is Asia/Kolkata too.
    expect(tenantLocalDate(clock, undefined)).toBe('2027-01-01');
    expect(formatAdmissionNumber(clock, 'Not/AZone', 12)).toBe('ADM-2027-0012');
    // A UTC tenant stays on the UTC calendar.
    expect(tenantLocalDate(clock, 'UTC')).toBe('2026-12-31');
  });

  it('falls back to the default zone for invalid values', () => {
    expect(resolveTenantTimeZone('')).toBe(DEFAULT_TENANT_TIMEZONE);
    expect(resolveTenantTimeZone(42)).toBe(DEFAULT_TENANT_TIMEZONE);
    expect(resolveTenantTimeZone('Europe/London')).toBe('Europe/London');
  });
});
