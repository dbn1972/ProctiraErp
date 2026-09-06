'use client';

/**
 * LanguageProvider — Internationalization context (Design Section C, Requirement 18)
 *
 * Owns the active locale, persists it to brand-namespaced localStorage,
 * stamps `document.documentElement.lang` and `dir` on every change, and
 * implements the `t()` fallback chain:
 *
 *     active locale → tenant default → platform default ('en') → key name
 *
 * The provider is a thin wrapper around `<NextIntlClientProvider>` so the
 * existing `useTranslations()` API from next-intl keeps working in pages
 * and components, while `useLanguage().t()` adds the explicit fallback
 * chain required by Requirement 18 AC 9.
 *
 * The provider is SSR-safe: every `window`, `document`, and `localStorage`
 * access is guarded so the module can be evaluated on the server, and the
 * brand-aware storage key gracefully falls back to `proctira-language`
 * when no `<BrandConfigProvider>` is in scope (Storybook, tests).
 *
 * Requirements: 18.1, 18.3, 18.4, 18.8, 18.9
 * Design: Section C
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { useOptionalBrand } from './BrandConfigProvider';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The Indian_Language_Set per Requirement 18.6, plus the Arabic RTL pilot
 * (`ar`) added in task 48.5. The wider RTL set (`he`, `fa`, `ur`, …) is
 * still runtime-only via {@link KNOWN_LOCALES} until the corresponding
 * catalogues land in `messages/`. The canonical {@link SUPPORTED_LOCALES}
 * list (the Indian_Language_Set) is unchanged — `ar` is exposed here so
 * the `LanguageSelector` and `setLocale()` types accept it without
 * casting now that the message catalogue exists.
 */
export type Locale = 'en' | 'hi' | 'ta' | 'te' | 'mr' | 'bn' | 'gu' | 'kn' | 'ar';
export type Direction = 'ltr' | 'rtl';

/** Nested, JSON-shaped translation catalog. */
export type TranslationMap = { [key: string]: string | TranslationMap };

export interface LanguageContextValue {
  /** Active locale code (e.g. 'en', 'hi', 'ar' once 48.5 lands). */
  locale: string;
  /** Switch the active locale; persists to localStorage. */
  setLocale: (locale: string) => void;
  /**
   * Translate a key with the spec-mandated fallback chain. ICU-style
   * `{name}` placeholders are interpolated when `params` are supplied.
   */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Resolved text direction for the active locale. */
  direction: Direction;
  /**
   * Alias of {@link direction}; preserved for backward compatibility with
   * the design.md `<DirectionalIcon>` snippet which destructures `dir`.
   */
  dir: Direction;
  /** The user-facing supported locale list (Indian_Language_Set). */
  supportedLocales: readonly Locale[];
}

export interface LanguageProviderProps {
  children: React.ReactNode;
  /**
   * Server-resolved active locale (e.g. from next-intl's `getLocale()`).
   * Used as the initial state on first render so SSR and CSR agree.
   */
  initialLocale?: string;
  /**
   * Tenant default locale; falls between the active locale and the
   * platform default in the {@link useLanguage} `t()` fallback chain.
   * Optional — if omitted, the chain collapses to active → platform → key.
   */
  tenantDefaultLocale?: string;
  /**
   * Pre-loaded message catalogs keyed by locale. Used by `app/layout.tsx`
   * to ship the server-rendered locale's messages without a second fetch,
   * and by tests to seed the cache without dynamic imports.
   */
  messagesByLocale?: Record<string, TranslationMap>;
  /**
   * Override the localStorage key. Defaults to `${brand.shortName}-language`
   * when wrapped in a `<BrandConfigProvider>` and to `proctira-language`
   * otherwise (Requirement 18 AC 8).
   */
  storageKey?: string;
  /** Override initial locale for tests; takes precedence over persisted value. */
  defaultLocale?: Locale;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Indian_Language_Set — the user-facing supported locales (Requirement 18.6). */
export const SUPPORTED_LOCALES: readonly Locale[] = [
  'en',
  'hi',
  'ta',
  'te',
  'mr',
  'bn',
  'gu',
  'kn',
] as const;

/** Platform default — used at the bottom of the fallback chain. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Locales recognized at runtime, including the RTL pilot locales. */
const KNOWN_LOCALES: ReadonlySet<string> = new Set<string>([
  ...SUPPORTED_LOCALES,
  // RTL pilot locales (per design.md §C and task 48.5).
  'ar',
  'he',
  'fa',
  'ur',
]);

/** ISO 639-1 / 639-3 base codes that always render right-to-left. */
const RTL_LOCALES: ReadonlySet<string> = new Set([
  'ar',
  'he',
  'fa',
  'ur',
  'ps',
  'sd',
  'yi',
  'dv',
  'ku',
  'ckb',
  'arc',
  'syr',
]);

/** Storage-key suffix; prefix is the brand shortName/slug. */
export const LANGUAGE_STORAGE_KEY_SUFFIX = '-language';

/** Used at boot before `useBrand()` is reachable (mirrors ThemeProvider). */
export const FALLBACK_LANGUAGE_STORAGE_KEY = `proctira${LANGUAGE_STORAGE_KEY_SUFFIX}`;

// ─── SSR-safe helpers ────────────────────────────────────────────────────────

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Returns the text direction for a locale. Strips the region subtag
 * (`ar-SA` → `ar`) so `setLocale('ar-SA')` still resolves to RTL.
 *
 * Exported so consumers (e.g., layouts that need to stamp `<html dir>` at
 * SSR time) can use the same logic without booting the React provider.
 */
export function getDirection(locale: string): Direction {
  if (!locale) return 'ltr';
  const normalized = locale.toLowerCase().trim();
  if (RTL_LOCALES.has(normalized)) return 'rtl';
  const base = normalized.split('-')[0];
  return base && RTL_LOCALES.has(base) ? 'rtl' : 'ltr';
}

function isKnownLocale(value: unknown): value is string {
  return typeof value === 'string' && KNOWN_LOCALES.has(value);
}

function getPersistedLocale(storageKey: string): string | null {
  if (!isBrowser()) return null;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return isKnownLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function persistLocale(storageKey: string, locale: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(storageKey, locale);
  } catch {
    /* localStorage may be unavailable (private mode, quota, …) */
  }
}

function applyDocumentAttributes(locale: string, direction: Direction): void {
  if (!isBrowser()) return;
  document.documentElement.lang = locale;
  document.documentElement.dir = direction;
}

/**
 * Walks the `messages` map by dot-notation key (e.g. `auth.signIn`).
 * Returns `undefined` when the key is absent or resolves to a sub-tree
 * rather than a leaf string.
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

/**
 * Replaces ICU-style `{name}` placeholders. Matches next-intl's syntax so
 * existing `en.json` strings (e.g., `"Welcome back, {name}"`) work in both
 * `useTranslations()` and our `t()` without re-templating.
 */
function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    return params[name] !== undefined ? String(params[name]) : match;
  });
}

/**
 * Dynamically imports the message catalog for a locale. Returns `null`
 * when the JSON file is missing (e.g. stub locales not yet shipped).
 */
async function loadMessagesFromDisk(
  locale: string,
): Promise<TranslationMap | null> {
  try {
    // Vite/webpack rewrites the template-literal dynamic import at build
    // time to a chunk per locale. Vitest resolves it through the same
    // alias map (`@` → `apps/web/src`).
    const mod = (await import(`@/messages/${locale}.json`)) as {
      default?: TranslationMap;
    };
    return mod.default ?? (mod as unknown as TranslationMap);
  } catch {
    return null;
  }
}

/**
 * Resolve the localStorage key to use:
 *   1. Explicit `storageKey` prop wins.
 *   2. Otherwise `${brand.shortName ?? brand.slug}-language` from brand.
 *   3. Otherwise the `proctira-language` fallback.
 *
 * Uses `useOptionalBrand()` so the provider stays mountable outside a
 * `<BrandConfigProvider>` (Storybook, isolated unit tests) without
 * calling hooks conditionally.
 */
function useResolvedStorageKey(override?: string): string {
  const brandCtx = useOptionalBrand();
  const brandShortName =
    (brandCtx?.brand as { shortName?: string } | undefined)?.shortName ??
    brandCtx?.brand?.slug ??
    undefined;

  return useMemo(() => {
    if (override) return override;
    if (brandShortName) return `${brandShortName}${LANGUAGE_STORAGE_KEY_SUFFIX}`;
    return FALLBACK_LANGUAGE_STORAGE_KEY;
  }, [override, brandShortName]);
}

// ─── Context ─────────────────────────────────────────────────────────────────

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export function LanguageProvider({
  children,
  initialLocale,
  tenantDefaultLocale,
  messagesByLocale,
  storageKey,
  defaultLocale,
}: LanguageProviderProps) {
  const resolvedStorageKey = useResolvedStorageKey(storageKey);

  // Initial locale precedence: explicit `defaultLocale` > persisted >
  // server-resolved `initialLocale` > platform default.
  const [locale, setLocaleState] = useState<string>(() => {
    if (defaultLocale && isKnownLocale(defaultLocale)) return defaultLocale;
    if (isBrowser()) {
      const persisted = getPersistedLocale(resolvedStorageKey);
      if (persisted) return persisted;
    }
    if (initialLocale && isKnownLocale(initialLocale)) return initialLocale;
    return DEFAULT_LOCALE;
  });

  // Translation cache lives in a ref so we mutate it without churning
  // React state. We bump `cacheVersion` whenever a new catalog arrives
  // so consumers re-render with up-to-date strings.
  const cacheRef = useRef<Map<string, TranslationMap>>(new Map());
  const [cacheVersion, setCacheVersion] = useState(0);

  // Seed the cache with any caller-supplied catalogs. Done as an effect
  // so the initial render still has the data available via the ref.
  if (messagesByLocale) {
    for (const [loc, msgs] of Object.entries(messagesByLocale)) {
      if (!cacheRef.current.has(loc)) {
        cacheRef.current.set(loc, msgs);
      }
    }
  }

  /**
   * Loads a locale catalog if absent from the cache. Skipped on the
   * server. Rejections are swallowed so a missing stub locale never
   * breaks the running app — t() simply continues down the fallback chain.
   */
  const ensureCatalog = useCallback((loc: string) => {
    if (!isBrowser()) return;
    if (cacheRef.current.has(loc)) return;
    void loadMessagesFromDisk(loc).then((map) => {
      if (map && !cacheRef.current.has(loc)) {
        cacheRef.current.set(loc, map);
        setCacheVersion((v) => v + 1);
      }
    });
  }, []);

  // Eagerly load every catalog the fallback chain may need.
  useEffect(() => {
    ensureCatalog(locale);
    if (tenantDefaultLocale && tenantDefaultLocale !== locale) {
      ensureCatalog(tenantDefaultLocale);
    }
    if (DEFAULT_LOCALE !== locale && DEFAULT_LOCALE !== tenantDefaultLocale) {
      ensureCatalog(DEFAULT_LOCALE);
    }
  }, [locale, tenantDefaultLocale, ensureCatalog]);

  const direction = getDirection(locale);

  // Apply document attributes on mount and on every locale change (AC 8).
  useEffect(() => {
    applyDocumentAttributes(locale, direction);
  }, [locale, direction]);

  const setLocale = useCallback(
    (next: string) => {
      if (!isKnownLocale(next)) return;
      setLocaleState(next);
      persistLocale(resolvedStorageKey, next);
      applyDocumentAttributes(next, getDirection(next));
      ensureCatalog(next);
    },
    [resolvedStorageKey, ensureCatalog],
  );

  const t = useCallback<LanguageContextValue['t']>(
    (key, params) => {
      // `cacheVersion` is read here so the lint rule sees the dependency
      // we declare below; the value itself is unused at runtime — its
      // sole purpose is to invalidate this useCallback when a new
      // catalog arrives via the dynamic loader.
      void cacheVersion;

      // Build the chain de-duplicated, preserving order:
      //   active → tenant default → platform default
      const chain: string[] = [locale];
      if (tenantDefaultLocale && !chain.includes(tenantDefaultLocale)) {
        chain.push(tenantDefaultLocale);
      }
      if (!chain.includes(DEFAULT_LOCALE)) {
        chain.push(DEFAULT_LOCALE);
      }

      for (const loc of chain) {
        const value = resolveKey(cacheRef.current.get(loc), key);
        if (value !== undefined) {
          return interpolate(value, params);
        }
      }
      // Last resort: surface the key itself so the developer sees a clear
      // signal in the UI (Requirement 18.9).
      return key;
    },
    [locale, tenantDefaultLocale, cacheVersion],
  );

  // Messages payload for next-intl: prefer the active locale's catalog,
  // then anything from the cache, then an empty object so the provider
  // doesn't crash on first paint when catalogs are still loading.
  const intlMessages = useMemo(() => {
    // `cacheVersion` is referenced so the dep array stays honest; the
    // actual catalog comes from the ref so the lookup stays cheap.
    void cacheVersion;
    return cacheRef.current.get(locale) ?? {};
  }, [locale, cacheVersion]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      direction,
      dir: direction,
      supportedLocales: SUPPORTED_LOCALES,
    }),
    [locale, setLocale, t, direction],
  );

  return (
    <LanguageContext.Provider value={value}>
      <NextIntlClientProvider
        // The `key` forces NextIntlClientProvider to fully reinitialize on
        // locale change so its internal formatter caches get rebuilt with
        // the right Intl options.
        key={locale}
        locale={locale}
        messages={intlMessages as never}
        timeZone="UTC"
      >
        {children}
      </NextIntlClientProvider>
    </LanguageContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Access the current language/i18n context.
 * Must be used within a `<LanguageProvider>`.
 */
export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a <LanguageProvider>');
  }
  return context;
}
