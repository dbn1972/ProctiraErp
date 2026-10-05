/**
 * PRC-M391: value-level validation for tenant config overrides that the
 * Typebox shape cannot express (IANA timezone, locale membership, IP/CIDR).
 */
import { isIP } from 'node:net';

import { ValidationError } from '@proctira/common';

import type { TenantConfig } from './schemas.js';

const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** IPv4/IPv6 address or CIDR with an in-range prefix length. */
export function isIpOrCidr(value: string): boolean {
  const [addr, prefix, ...rest] = value.trim().split('/');
  if (rest.length > 0 || !addr) return false;
  const family = isIP(addr);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const n = Number(prefix);
  return n >= 0 && n <= (family === 4 ? 32 : 128);
}

export function assertTenantConfigValues(
  override: Partial<TenantConfig>,
  base: Partial<TenantConfig> = {},
): void {
  const errors: Array<{ field: string; message: string; rule: string }> = [];
  const locale = override.locale;
  if (locale) {
    const merged = { ...base.locale, ...locale };
    if (locale.timezone !== undefined && !isIanaTimeZone(locale.timezone)) {
      errors.push({
        field: 'config.locale.timezone',
        message: 'timezone must be a valid IANA time zone',
        rule: 'format',
      });
    }
    const locales = merged.supportedLocales ?? [];
    for (const code of [merged.defaultLocale, ...locales]) {
      if (code !== undefined && !LOCALE_PATTERN.test(code)) {
        errors.push({
          field: 'config.locale',
          message: `'${code}' is not a valid locale code`,
          rule: 'format',
        });
      }
    }
    if (merged.defaultLocale !== undefined && !locales.includes(merged.defaultLocale)) {
      errors.push({
        field: 'config.locale.defaultLocale',
        message: 'defaultLocale must be one of supportedLocales',
        rule: 'membership',
      });
    }
  }
  for (const entry of override.security?.ipWhitelist ?? []) {
    if (!isIpOrCidr(entry)) {
      errors.push({
        field: 'config.security.ipWhitelist',
        message: `'${entry}' is not a valid IP address or CIDR`,
        rule: 'format',
      });
    }
  }
  if (errors.length > 0) throw new ValidationError('Invalid tenant configuration', errors);
}
