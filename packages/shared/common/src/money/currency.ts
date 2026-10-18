/**
 * Decision D1 — canonical currency model for the ProctiraERP platform.
 *
 * - Default currency is INR (ISO-4217 `"INR"`). All money defaults resolve here.
 * - Monetary amounts stay integer minor units (paise); see {@link ./cents.js}.
 * - Multi-currency is modelled **per COUNTRY, not per tenant**. This module
 *   exposes a `country → currency` resolver seeded ONLY with `IN → INR`; other
 *   countries can be added later without touching call sites.
 *
 * Keep this minimal and canonical — findings route their currency through here
 * instead of hard-coding `'INR'`/`'USD'` literals.
 */

import { BusinessRuleError } from '../exceptions/index.js';

/** Default platform currency (Decision D1): Indian Rupee, ISO-4217 `INR`. */
export const DEFAULT_CURRENCY = 'INR';

/**
 * Country (ISO-3166 alpha-2) → ISO-4217 currency.
 * Seeded ONLY with India now (Decision D1); add more countries here later.
 * This is intentionally a per-COUNTRY map — there is no per-tenant currency.
 */
const COUNTRY_CURRENCY: Readonly<Record<string, string>> = Object.freeze({
  IN: 'INR',
});

/** True when `code` is a syntactically valid ISO-4217 code (3 uppercase A–Z). */
export function isIso4217Code(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z]{3}$/.test(code);
}

/**
 * Assert that `code` is a valid ISO-4217 currency code and return it.
 * Rejects empty, lowercase, wrong-length, and non-string values.
 */
export function assertIso4217Code(code: unknown): string {
  if (!isIso4217Code(code)) {
    throw new BusinessRuleError(
      `Invalid ISO-4217 currency code: ${JSON.stringify(code)} (expected 3 uppercase letters)`,
    );
  }
  return code;
}

/**
 * Resolve the currency for a country (ISO-3166 alpha-2, case-insensitive).
 * Unknown/empty countries fall back to {@link DEFAULT_CURRENCY} (INR).
 * Per Decision D1 this is the single country→currency path; do not add a
 * per-tenant currency setting.
 */
export function currencyForCountry(countryCode?: string | null): string {
  if (typeof countryCode === 'string') {
    const key = countryCode.trim().toUpperCase();
    const mapped = COUNTRY_CURRENCY[key];
    if (mapped) return mapped;
  }
  return DEFAULT_CURRENCY;
}
