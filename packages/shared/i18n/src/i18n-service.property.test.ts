/**
 * Property-based tests for i18n service.
 *
 * Property 29: Translation Fallback Chain
 * Property 30: Locale-Specific Formatting
 *
 * **Validates: Requirements 18.3, 18.5**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { I18nServiceImpl } from './i18n-service';
import type { I18nConfig, TranslationMap } from './types';

// --- Arbitraries ---

/** Generates a valid translation key (dot-separated segments). */
const translationKeyArb: fc.Arbitrary<string> = fc
  .array(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: 1,
      maxLength: 10,
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map((parts) => parts.join('.'));

/** Generates a simple translation value string. */
const translationValueArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz 0123456789'.split('')),
  { minLength: 1, maxLength: 50 },
);

/** Supported locale codes for testing. */
const SUPPORTED_LOCALES = ['en', 'ar', 'fr', 'es', 'de', 'he', 'ur', 'ja', 'zh'] as const;

/** Generates a locale code from the supported set. */
const localeArb: fc.Arbitrary<string> = fc.constantFrom(...SUPPORTED_LOCALES);

/** Generates a Date object within a reasonable range. */
const dateArb: fc.Arbitrary<Date> = fc
  .integer({ min: 946684800000, max: 1893456000000 }) // 2000-01-01 to 2030-01-01
  .map((ts) => new Date(ts));

/** Generates a finite number suitable for formatting. */
const numberArb: fc.Arbitrary<number> = fc.double({
  min: -1_000_000_000,
  max: 1_000_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Generates a positive currency amount. */
const currencyAmountArb: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 10_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Generates a valid ISO 4217 currency code. */
const currencyCodeArb: fc.Arbitrary<string> = fc.constantFrom(
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'SAR',
  'AED',
  'INR',
  'CNY',
  'AUD',
  'CAD',
);

/**
 * Builds a nested TranslationMap from a flat key-value pair.
 * e.g., ("common.buttons.save", "Save") → { common: { buttons: { save: "Save" } } }
 */
function buildTranslationMap(entries: Array<[string, string]>): TranslationMap {
  const map: TranslationMap = {};
  for (const [key, value] of entries) {
    const parts = key.split('.');
    let current: TranslationMap = map;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part] || typeof current[part] === 'string') {
        current[part] = {};
      }
      current = current[part] as TranslationMap;
    }
    current[parts[parts.length - 1]] = value;
  }
  return map;
}

// --- Property 29: Translation Fallback Chain ---

describe('Property 29: Translation Fallback Chain', () => {
  // Feature: proctira-unified-platform, Property 29: Translation Fallback Chain
  // **Validates: Requirements 18.3**

  it('should return the key name when translation is missing from ALL locales in the fallback chain', () => {
    fc.assert(
      fc.property(
        translationKeyArb,
        localeArb,
        localeArb,
        localeArb,
        (key, userLocale, tenantDefault, platformDefault) => {
          // Create a service with empty translations for all locales
          const config: I18nConfig = {
            supportedLocales: [...SUPPORTED_LOCALES],
            defaultLocale: platformDefault,
            fallbackLocale: platformDefault,
            tenantDefaultLocale: tenantDefault,
          };

          const service = new I18nServiceImpl({
            config,
            translations: {
              [userLocale]: {},
              [tenantDefault]: {},
              [platformDefault]: {},
            },
          });

          service.setLocale(userLocale);
          const result = service.translate(key);

          // When key is not found anywhere, the key name itself is returned
          expect(result).toBe(key);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should fall back to tenant default when key is missing in user locale', () => {
    fc.assert(
      fc.property(translationKeyArb, translationValueArb, (key, tenantValue) => {
        // Key exists only in tenant default locale (fr), not in user locale (ar)
        const config: I18nConfig = {
          supportedLocales: [...SUPPORTED_LOCALES],
          defaultLocale: 'en',
          fallbackLocale: 'en',
          tenantDefaultLocale: 'fr',
        };

        const frMap = buildTranslationMap([[key, tenantValue]]);

        const service = new I18nServiceImpl({
          config,
          translations: {
            ar: {},
            fr: frMap,
            en: {},
          },
        });

        service.setLocale('ar');
        const result = service.translate(key);

        // Should fall back to tenant default (fr) and find the value
        expect(result).toBe(tenantValue);
      }),
      { numRuns: 100 },
    );
  });

  it('should fall back to platform default when key is missing in user locale and tenant default', () => {
    fc.assert(
      fc.property(translationKeyArb, translationValueArb, (key, platformValue) => {
        // Key exists only in platform default (en), not in user locale (ar) or tenant default (fr)
        const config: I18nConfig = {
          supportedLocales: [...SUPPORTED_LOCALES],
          defaultLocale: 'en',
          fallbackLocale: 'en',
          tenantDefaultLocale: 'fr',
        };

        const enMap = buildTranslationMap([[key, platformValue]]);

        const service = new I18nServiceImpl({
          config,
          translations: {
            ar: {},
            fr: {},
            en: enMap,
          },
        });

        service.setLocale('ar');
        const result = service.translate(key);

        // Should fall back to platform default (en) and find the value
        expect(result).toBe(platformValue);
      }),
      { numRuns: 100 },
    );
  });

  it('should prefer user locale translation over any fallback', () => {
    fc.assert(
      fc.property(
        translationKeyArb,
        translationValueArb,
        translationValueArb,
        translationValueArb,
        (key, userValue, tenantValue, platformValue) => {
          // Key exists in all locales — user locale should win
          const config: I18nConfig = {
            supportedLocales: [...SUPPORTED_LOCALES],
            defaultLocale: 'en',
            fallbackLocale: 'en',
            tenantDefaultLocale: 'fr',
          };

          const arMap = buildTranslationMap([[key, userValue]]);
          const frMap = buildTranslationMap([[key, tenantValue]]);
          const enMap = buildTranslationMap([[key, platformValue]]);

          const service = new I18nServiceImpl({
            config,
            translations: {
              ar: arMap,
              fr: frMap,
              en: enMap,
            },
          });

          service.setLocale('ar');
          const result = service.translate(key);

          // User locale takes priority
          expect(result).toBe(userValue);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should follow strict fallback order: user locale → tenant default → platform default → key name', () => {
    fc.assert(
      fc.property(
        translationKeyArb,
        translationValueArb,
        translationValueArb,
        translationValueArb,
        // Which locales have the key: [userHas, tenantHas, platformHas]
        fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
        (key, userValue, tenantValue, platformValue, [userHas, tenantHas, platformHas]) => {
          const config: I18nConfig = {
            supportedLocales: [...SUPPORTED_LOCALES],
            defaultLocale: 'en',
            fallbackLocale: 'en',
            tenantDefaultLocale: 'fr',
          };

          const arMap = userHas ? buildTranslationMap([[key, userValue]]) : {};
          const frMap = tenantHas ? buildTranslationMap([[key, tenantValue]]) : {};
          const enMap = platformHas ? buildTranslationMap([[key, platformValue]]) : {};

          const service = new I18nServiceImpl({
            config,
            translations: { ar: arMap, fr: frMap, en: enMap },
          });

          service.setLocale('ar');
          const result = service.translate(key);

          // Determine expected result based on fallback chain priority
          if (userHas) {
            expect(result).toBe(userValue);
          } else if (tenantHas) {
            expect(result).toBe(tenantValue);
          } else if (platformHas) {
            expect(result).toBe(platformValue);
          } else {
            expect(result).toBe(key);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// --- Property 30: Locale-Specific Formatting ---

describe('Property 30: Locale-Specific Formatting', () => {
  // Feature: proctira-unified-platform, Property 30: Locale-Specific Formatting
  // **Validates: Requirements 18.5**

  const config: I18nConfig = {
    supportedLocales: [...SUPPORTED_LOCALES],
    defaultLocale: 'en',
    fallbackLocale: 'en',
  };

  function createService(locale: string): I18nServiceImpl {
    const service = new I18nServiceImpl({
      config,
      translations: {},
    });
    service.setLocale(locale);
    return service;
  }

  it('should format dates consistently with Intl.DateTimeFormat for any locale', () => {
    fc.assert(
      fc.property(
        localeArb,
        dateArb,
        fc.constantFrom('short' as const, 'medium' as const, 'long' as const, 'full' as const),
        (locale, date, style) => {
          const service = createService(locale);
          const formatted = service.formatDate(date, style);

          // The formatted output must be a non-empty string
          expect(formatted.length).toBeGreaterThan(0);

          // The formatted output must match what Intl.DateTimeFormat produces for that locale
          const styleOptions: Record<string, Intl.DateTimeFormatOptions> = {
            short: { year: 'numeric', month: 'numeric', day: 'numeric' },
            medium: { year: 'numeric', month: 'short', day: 'numeric' },
            long: { year: 'numeric', month: 'long', day: 'numeric' },
            full: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
          };
          const expected = new Intl.DateTimeFormat(locale, styleOptions[style]).format(date);
          expect(formatted).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should format numbers consistently with Intl.NumberFormat for any locale', () => {
    fc.assert(
      fc.property(localeArb, numberArb, (locale, value) => {
        const service = createService(locale);
        const formatted = service.formatNumber(value);

        // The formatted output must be a non-empty string
        expect(formatted.length).toBeGreaterThan(0);

        // Must match Intl.NumberFormat for that locale
        const expected = new Intl.NumberFormat(locale, { style: 'decimal' }).format(value);
        expect(formatted).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('should format currency consistently with Intl.NumberFormat currency style for any locale', () => {
    fc.assert(
      fc.property(localeArb, currencyAmountArb, currencyCodeArb, (locale, amount, currency) => {
        const service = createService(locale);
        const formatted = service.formatCurrency(amount, currency);

        // The formatted output must be a non-empty string
        expect(formatted.length).toBeGreaterThan(0);

        // Must match Intl.NumberFormat with currency style for that locale
        const expected = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          currencyDisplay: 'symbol',
        }).format(amount);
        expect(formatted).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('should produce different formatting for different locales with the same value', () => {
    fc.assert(
      fc.property(
        // Use a large number that will show locale differences in grouping/separators
        fc.constant(1234567.89),
        (value) => {
          const enService = createService('en');
          const frService = createService('fr');
          const arService = createService('ar');

          const enFormatted = enService.formatNumber(value);
          const frFormatted = frService.formatNumber(value);
          const arFormatted = arService.formatNumber(value);

          // At least two of the three should differ (locales use different separators)
          const allSame = enFormatted === frFormatted && frFormatted === arFormatted;
          expect(allSame).toBe(false);
        },
      ),
      { numRuns: 1 },
    );
  });

  it('should format numbers with custom fraction digits respecting locale conventions', () => {
    fc.assert(
      fc.property(
        localeArb,
        numberArb,
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (locale, value, minFrac, maxFracDelta) => {
          const maxFrac = minFrac + maxFracDelta; // ensure max >= min
          const service = createService(locale);
          const formatted = service.formatNumber(value, {
            minimumFractionDigits: minFrac,
            maximumFractionDigits: maxFrac,
          });

          // Must match Intl.NumberFormat with same options
          const expected = new Intl.NumberFormat(locale, {
            style: 'decimal',
            minimumFractionDigits: minFrac,
            maximumFractionDigits: maxFrac,
          }).format(value);
          expect(formatted).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
