import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COUNTRY_CODE,
  defaultTenantConfig,
  getCountry,
  isCountryImplemented,
  listCountries,
  listImplementedCountries,
  normalizeCountryCode,
  requireCountry,
  tenantConfigFromCountry,
} from './catalog.js';

describe('country catalog', () => {
  it('treats India as the default implemented country', () => {
    expect(DEFAULT_COUNTRY_CODE).toBe('IN');
    expect(isCountryImplemented('in')).toBe(true);
    expect(listImplementedCountries().map((c) => c.code)).toEqual(['IN']);
  });

  it('exposes India school-system defaults', () => {
    const india = requireCountry('IN');

    expect(india.name).toBe('India');
    expect(india.currency).toBe('INR');
    expect(india.timezone).toBe('Asia/Kolkata');
    expect(india.academicYearStartMonth).toBe(4);
    expect(india.nationalIdLabel).toBe('Aadhaar');
    expect(india.boards).toEqual(['CBSE', 'ICSE', 'STATE']);
    expect(india.locales).toContain('hi');
    expect(india.features.udise).toBe(true);
  });

  it('keeps other catalog countries planned, not implemented', () => {
    const planned = listCountries().filter((c) => c.code !== 'IN');

    expect(planned.length).toBeGreaterThan(0);
    for (const country of planned) {
      expect(country.status).toBe('planned');
      expect(isCountryImplemented(country.code)).toBe(false);
    }
  });

  it('normalizes codes and rejects unknowns', () => {
    expect(normalizeCountryCode(' in ')).toBe('IN');
    expect(getCountry('xx')).toBeUndefined();
    expect(() => requireCountry('XX')).toThrow('Unknown country code: XX');
  });

  it('builds tenant config from a country profile', () => {
    const config = tenantConfigFromCountry(requireCountry('IN'));

    expect(config.countryCode).toBe('IN');
    expect(config.locale).toBe('en');
    expect(config.timezone).toBe('Asia/Kolkata');
    expect(config.currency).toBe('INR');
    expect(config.academicYearStart).toBe(4);
    expect(defaultTenantConfig()).toEqual(config);
  });
});
