import { describe, expect, it } from 'vitest';
import {
  loadAdmissionsTimeZone,
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
describe('PRC-L002 loadAdmissionsTimeZone', () => {
  function client(settingsTz: unknown, localeTz: unknown, flatTz: unknown = null) {
    const calls: string[] = [];
    return {
      calls,
      async query(sql: string) {
        calls.push(sql);
        if (sql.includes('control_plane_documents')) {
          return { rows: settingsTz === undefined ? [] : [{ tz: settingsTz }] };
        }
        return { rows: [{ locale_tz: localeTz, flat_tz: flatTz }] };
      },
    };
  }
  it('prefers the admin tenant-settings zone over tenants.config', async () => {
    const db = client('Asia/Kolkata', 'UTC');
    await expect(loadAdmissionsTimeZone(db, 't1')).resolves.toBe('Asia/Kolkata');
    expect(db.calls).toHaveLength(1);
  });
  it('skips invalid settings and falls back to config locale, then flat config, then default', async () => {
    await expect(loadAdmissionsTimeZone(client('Not/AZone', 'Asia/Dubai'), 't1')).resolves.toBe(
      'Asia/Dubai',
    );
    await expect(
      loadAdmissionsTimeZone(client(undefined, null, 'Europe/London'), 't1'),
    ).resolves.toBe('Europe/London');
    await expect(loadAdmissionsTimeZone(client(undefined, '', null), 't1')).resolves.toBe(
      'Asia/Kolkata',
    );
  });
  it('never elevates the transaction to platform scope', async () => {
    const db = client(undefined, 'Asia/Kolkata');
    await loadAdmissionsTimeZone(db, 't1');
    expect(db.calls.join('\n')).not.toMatch(/platform_admin|set_config/);
  });
});
