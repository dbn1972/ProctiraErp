import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TENANT_TIMEZONE,
  isValidIanaTimezone,
  resolveTenantTimezone,
} from './tenant-timezone.js';

describe('W3-TIME-01 tenant timezone foundation', () => {
  describe('isValidIanaTimezone', () => {
    it('accepts common IANA zones', () => {
      expect(isValidIanaTimezone('UTC')).toBe(true);
      expect(isValidIanaTimezone('Asia/Kolkata')).toBe(true);
      expect(isValidIanaTimezone('Europe/Paris')).toBe(true);
    });

    it('rejects invalid zone names', () => {
      expect(isValidIanaTimezone('')).toBe(false);
      expect(isValidIanaTimezone('Not/A/Timezone')).toBe(false);
      expect(isValidIanaTimezone('GMT+5:30')).toBe(false);
    });
  });

  describe('resolveTenantTimezone', () => {
    it('defaults to UTC when no source is provided', () => {
      expect(resolveTenantTimezone()).toBe(DEFAULT_TENANT_TIMEZONE);
      expect(resolveTenantTimezone({})).toBe(DEFAULT_TENANT_TIMEZONE);
    });

    it('prefers the first-class timezone column', () => {
      expect(
        resolveTenantTimezone({
          timezone: 'Asia/Kolkata',
          settings: { timezone: 'Europe/London' },
          config: { timezone: 'America/New_York' },
        }),
      ).toBe('Asia/Kolkata');
    });

    it('reads admin settings timezone', () => {
      expect(resolveTenantTimezone({ settings: { timezone: 'Asia/Riyadh' } })).toBe('Asia/Riyadh');
    });

    it('reads lifecycle locale.timezone', () => {
      expect(
        resolveTenantTimezone({
          locale: { timezone: 'Asia/Singapore' },
        }),
      ).toBe('Asia/Singapore');
    });

    it('reads flat config.timezone (legacy factory shape)', () => {
      expect(resolveTenantTimezone({ config: { timezone: 'Asia/Tokyo' } })).toBe('Asia/Tokyo');
    });

    it('reads nested config.locale.timezone', () => {
      expect(
        resolveTenantTimezone({
          config: { locale: { timezone: 'Australia/Sydney' } },
        }),
      ).toBe('Australia/Sydney');
    });

    it('skips invalid values and falls back to UTC', () => {
      expect(
        resolveTenantTimezone({
          timezone: 'bogus-zone',
          settings: { timezone: '   ' },
          config: { timezone: 'Also/Wrong' },
        }),
      ).toBe(DEFAULT_TENANT_TIMEZONE);
    });
  });
});
