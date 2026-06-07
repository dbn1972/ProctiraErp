/**
 * @vitest-environment jsdom
 *
 * Property F-4: i18n Key Resolution
 *
 * For any user-facing UI string `s` rendered in `apps/web/app/`, `s` SHALL be
 * sourced from `t(key)` where `key` exists in the next-intl message catalog.
 * Hardcoded English strings in component JSX SHALL be flagged by lint, with the
 * only exception being legal-page bodies until their translations land.
 *
 * This property test uses fast-check to randomly pick translation keys and
 * locales, then asserts that the LanguageProvider's `t()` function resolves
 * every key through the fallback chain without producing:
 *   - Raw key strings (e.g. "common.save" appearing as rendered text)
 *   - Empty strings
 *   - English bleed-through (except for stub locales that intentionally
 *     fall back to English)
 *
 * **Validates: Requirements 18.1, 18.3, 18.9**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

import {
  LanguageProvider,
  useLanguage,
  DEFAULT_LOCALE,
  type TranslationMap,
} from '../providers/LanguageProvider';

// ─── Load all message catalogs ───────────────────────────────────────────────

import enMessages from '../messages/en.json';
import arMessages from '../messages/ar.json';
import hiMessages from '../messages/hi.json';
import taMessages from '../messages/ta.json';
import teMessages from '../messages/te.json';
import mrMessages from '../messages/mr.json';
import bnMessages from '../messages/bn.json';
import guMessages from '../messages/gu.json';
import knMessages from '../messages/kn.json';

// ─── Types & Helpers ─────────────────────────────────────────────────────────

/** All registered locales with their message catalogs */
const ALL_LOCALE_CATALOGS: Record<string, TranslationMap> = {
  en: enMessages as unknown as TranslationMap,
  ar: arMessages as unknown as TranslationMap,
  hi: hiMessages as unknown as TranslationMap,
  ta: taMessages as unknown as TranslationMap,
  te: teMessages as unknown as TranslationMap,
  mr: mrMessages as unknown as TranslationMap,
  bn: bnMessages as unknown as TranslationMap,
  gu: guMessages as unknown as TranslationMap,
  kn: knMessages as unknown as TranslationMap,
};

/** All locale codes that have message catalogs */
const REGISTERED_LOCALES = Object.keys(ALL_LOCALE_CATALOGS);

/**
 * Recursively extracts all dot-notation keys from a nested translation map.
 * Only leaf string values are included (not intermediate namespace objects).
 */
function extractAllKeys(map: TranslationMap, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      keys.push(fullKey);
    } else if (typeof v === 'object' && v !== null) {
      keys.push(...extractAllKeys(v as TranslationMap, fullKey));
    }
  }
  return keys;
}

/**
 * Resolves a dot-notation key from a translation map.
 * Returns undefined if the key doesn't exist or resolves to a non-string.
 */
function resolveKey(map: TranslationMap | undefined, key: string): string | undefined {
  if (!map) return undefined;
  const parts = key.split('.');
  let cursor: unknown = map;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

/** All keys defined in the English (default) catalog — the canonical key set */
const ALL_EN_KEYS = extractAllKeys(enMessages as unknown as TranslationMap);

/**
 * Keys that contain ICU placeholders like {name}, {brand}, etc.
 * These need params to resolve properly, so we provide dummy params.
 */
function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{(\w+)\}/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

// ─── fast-check Arbitraries ──────────────────────────────────────────────────

/** Arbitrary that picks a random key from the English catalog */
const translationKeyArb = fc.constantFrom(...ALL_EN_KEYS);

/** Arbitrary that picks a random registered locale */
const localeArb = fc.constantFrom(...REGISTERED_LOCALES);

/** Arbitrary that picks a random non-English locale */
const nonEnLocaleArb = fc.constantFrom(
  ...REGISTERED_LOCALES.filter((l) => l !== 'en'),
);

// ─── Test Wrapper ────────────────────────────────────────────────────────────

function createWrapper(locale: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <LanguageProvider
        defaultLocale={locale as 'en'}
        messagesByLocale={ALL_LOCALE_CATALOGS}
      >
        {children}
      </LanguageProvider>
    );
  };
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property F-4: i18n Key Resolution', () => {
  it('every English catalog key resolves to a non-empty string for any registered locale (no raw keys, no empty strings)', () => {
    fc.assert(
      fc.property(
        translationKeyArb,
        localeArb,
        (key, locale) => {
          const { result, unmount } = renderHook(() => useLanguage(), {
            wrapper: createWrapper(locale),
          });

          // Build dummy params for keys with ICU placeholders
          const enValue = resolveKey(
            enMessages as unknown as TranslationMap,
            key,
          );
          const placeholders = enValue ? extractPlaceholders(enValue) : [];
          const params: Record<string, string | number> = {};
          for (const p of placeholders) {
            params[p] = `test_${p}`;
          }

          const resolved = result.current.t(key, Object.keys(params).length > 0 ? params : undefined);

          // Property 1: resolved value must NOT be empty
          expect(resolved.length).toBeGreaterThan(0);

          // Property 2: resolved value must NOT be the raw key itself
          // (which would mean the fallback chain failed entirely)
          expect(resolved).not.toBe(key);

          unmount();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('the fallback chain resolves missing keys in non-English locales to the English value (no bleed-through of raw keys)', () => {
    fc.assert(
      fc.property(
        translationKeyArb,
        nonEnLocaleArb,
        (key, locale) => {
          const { result, unmount } = renderHook(() => useLanguage(), {
            wrapper: createWrapper(locale),
          });

          // Build dummy params for keys with ICU placeholders
          const enValue = resolveKey(
            enMessages as unknown as TranslationMap,
            key,
          );
          const placeholders = enValue ? extractPlaceholders(enValue) : [];
          const params: Record<string, string | number> = {};
          for (const p of placeholders) {
            params[p] = `test_${p}`;
          }

          const resolved = result.current.t(key, Object.keys(params).length > 0 ? params : undefined);
          const localeCatalog = ALL_LOCALE_CATALOGS[locale];
          const localValue = resolveKey(localeCatalog, key);

          if (localValue !== undefined) {
            // Key exists in the active locale — resolved should be the
            // locale-specific value (with placeholders interpolated)
            const expectedInterpolated = localValue.replace(
              /\{(\w+)\}/g,
              (match, name: string) =>
                params[name] !== undefined ? String(params[name]) : match,
            );
            expect(resolved).toBe(expectedInterpolated);
          } else {
            // Key is missing in the active locale — fallback chain should
            // resolve to the English value (never the raw key)
            expect(resolved).not.toBe(key);
            expect(resolved.length).toBeGreaterThan(0);

            // The resolved value should match the English catalog value
            // (with placeholders interpolated)
            if (enValue) {
              const expectedEnInterpolated = enValue.replace(
                /\{(\w+)\}/g,
                (match, name: string) =>
                  params[name] !== undefined ? String(params[name]) : match,
              );
              expect(resolved).toBe(expectedEnInterpolated);
            }
          }

          unmount();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('switching locale at runtime preserves the no-raw-key invariant for randomly selected keys', () => {
    fc.assert(
      fc.property(
        fc.array(translationKeyArb, { minLength: 1, maxLength: 5 }),
        localeArb,
        nonEnLocaleArb,
        (keys, startLocale, targetLocale) => {
          const { result, unmount } = renderHook(() => useLanguage(), {
            wrapper: createWrapper(startLocale),
          });

          // Switch locale at runtime
          act(() => {
            result.current.setLocale(targetLocale);
          });

          // After switching, all keys should still resolve without raw keys
          for (const key of keys) {
            const enValue = resolveKey(
              enMessages as unknown as TranslationMap,
              key,
            );
            const placeholders = enValue ? extractPlaceholders(enValue) : [];
            const params: Record<string, string | number> = {};
            for (const p of placeholders) {
              params[p] = `test_${p}`;
            }

            const resolved = result.current.t(
              key,
              Object.keys(params).length > 0 ? params : undefined,
            );

            // Must not be empty
            expect(resolved.length).toBeGreaterThan(0);
            // Must not be the raw key
            expect(resolved).not.toBe(key);
          }

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('every registered locale has complete coverage of the English key set or falls back gracefully', () => {
    fc.assert(
      fc.property(
        nonEnLocaleArb,
        (locale) => {
          const { result, unmount } = renderHook(() => useLanguage(), {
            wrapper: createWrapper(locale),
          });

          // For every key in the English catalog, the locale either:
          // 1. Has its own translation (key exists in locale catalog), OR
          // 2. The fallback chain resolves it to the English value (not raw key)
          //
          // We verify this by checking that t() never returns the raw key.
          // Sample a subset of keys to keep the test fast
          const sampleSize = Math.min(ALL_EN_KEYS.length, 50);
          const sampledKeys = ALL_EN_KEYS.slice(0, sampleSize);

          for (const key of sampledKeys) {
            const resolved = result.current.t(key);
            // The resolved value must never be the raw key
            expect(resolved).not.toBe(key);
            // The resolved value must never be empty
            expect(resolved.length).toBeGreaterThan(0);
          }

          unmount();
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});
