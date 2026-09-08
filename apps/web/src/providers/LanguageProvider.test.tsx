/**
 * @vitest-environment jsdom
 *
 * LanguageProvider tests — Task 48.1 / Requirement 18
 *
 * Covers:
 *   • localStorage round-trip under the brand-aware key (AC 8)
 *   • document.documentElement.lang and dir update on change (AC 8)
 *   • RTL direction for `ar`, `he`, `fa`, `ur`; LTR otherwise (AC 4 + design.md §C)
 *   • t() fallback chain: active → tenant default → platform default → key
 *     (AC 9 + Requirement 18 AC 9 fallback rule)
 *   • Brand-aware vs. fallback storage key resolution
 *   • SSR safety: no crash when localStorage throws or DOM is missing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import React from 'react';

import {
  LanguageProvider,
  useLanguage,
  getDirection,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LANGUAGE_STORAGE_KEY,
  LANGUAGE_STORAGE_KEY_SUFFIX,
  type TranslationMap,
} from './LanguageProvider';
import { BrandConfigProvider, DEFAULT_BRAND, type Brand } from './BrandConfigProvider';

// Stub the runtime dynamic import so tests are deterministic. We also
// override it per-suite to simulate missing/partial catalogs.
vi.mock('@/messages/en.json', () => ({
  default: {
    common: { save: 'Save', loading: 'Loading…' },
    auth: { signIn: 'Sign In' },
  },
}));

vi.mock('@/messages/hi.json', () => ({
  default: {
    common: { save: 'सहेजें' },
    // Note: `auth.signIn` is intentionally MISSING from `hi` so the
    // fallback chain must reach `en` to resolve it.
  },
}));

// `ar` deliberately ships only a subset to exercise the chain when both
// tenant default and active locale are missing a key.
vi.mock('@/messages/ar.json', () => ({
  default: {
    common: { save: 'حفظ' },
  },
}));

// French, used here as a tenant default that fills in the gap when the
// active locale's catalog is missing the key.
vi.mock('@/messages/fr.json', () => ({
  default: {
    common: { loading: 'Chargement…' },
    auth: { signIn: 'Se connecter' },
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const enMessages: TranslationMap = {
  common: { save: 'Save', loading: 'Loading…' },
  auth: { signIn: 'Sign In' },
};

const hiMessages: TranslationMap = {
  common: { save: 'सहेजें' },
};

const frMessages: TranslationMap = {
  common: { loading: 'Chargement…' },
  auth: { signIn: 'Se connecter' },
};

interface ConsumeOptions {
  initialLocale?: string;
  defaultLocale?: 'en' | 'hi' | 'ta' | 'te' | 'mr' | 'bn' | 'gu' | 'kn';
  tenantDefaultLocale?: string;
  storageKey?: string;
  messagesByLocale?: Record<string, TranslationMap>;
  brand?: Brand;
}

function consume(opts: ConsumeOptions = {}) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    const provider = (
      <LanguageProvider
        initialLocale={opts.initialLocale}
        defaultLocale={opts.defaultLocale}
        tenantDefaultLocale={opts.tenantDefaultLocale}
        storageKey={opts.storageKey}
        messagesByLocale={
          opts.messagesByLocale ?? {
            en: enMessages,
            hi: hiMessages,
            fr: frMessages,
          }
        }
      >
        {children}
      </LanguageProvider>
    );
    if (opts.brand) {
      return <BrandConfigProvider initialBrand={opts.brand}>{provider}</BrandConfigProvider>;
    }
    return provider;
  };

  return renderHook(() => useLanguage(), { wrapper: Wrapper });
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LanguageProvider — defaults & contract', () => {
  it('useLanguage throws outside of <LanguageProvider>', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useLanguage())).toThrow(/within a <LanguageProvider>/);
    spy.mockRestore();
  });

  it('defaults to English with LTR direction and exposes the supported locale list', () => {
    const { result } = consume();
    expect(result.current.locale).toBe(DEFAULT_LOCALE);
    expect(result.current.direction).toBe('ltr');
    expect(result.current.dir).toBe('ltr');
    expect(result.current.supportedLocales).toEqual(SUPPORTED_LOCALES);
  });

  it('honors `defaultLocale` prop above persisted value', () => {
    window.localStorage.setItem(FALLBACK_LANGUAGE_STORAGE_KEY, 'hi');
    const { result } = consume({ defaultLocale: 'ta' });
    expect(result.current.locale).toBe('ta');
  });

  it('uses `initialLocale` from server when no value is persisted', () => {
    const { result } = consume({ initialLocale: 'hi' });
    expect(result.current.locale).toBe('hi');
  });
});

describe('LanguageProvider — localStorage round-trip', () => {
  it('persists the chosen locale under the fallback key when no brand is in scope', () => {
    const { result } = consume();

    act(() => result.current.setLocale('hi'));

    expect(window.localStorage.getItem(FALLBACK_LANGUAGE_STORAGE_KEY)).toBe('hi');
    expect(result.current.locale).toBe('hi');
  });

  it('rehydrates a persisted locale on a fresh mount', () => {
    window.localStorage.setItem(FALLBACK_LANGUAGE_STORAGE_KEY, 'hi');
    const { result } = consume();
    expect(result.current.locale).toBe('hi');
  });

  it('ignores unknown values written to localStorage', () => {
    window.localStorage.setItem(FALLBACK_LANGUAGE_STORAGE_KEY, 'klingon');
    const { result } = consume();
    expect(result.current.locale).toBe(DEFAULT_LOCALE);
  });

  it('cycles en → hi → ta and writes each value to localStorage', () => {
    const { result } = consume();

    act(() => result.current.setLocale('hi'));
    expect(window.localStorage.getItem(FALLBACK_LANGUAGE_STORAGE_KEY)).toBe('hi');

    act(() => result.current.setLocale('ta'));
    expect(window.localStorage.getItem(FALLBACK_LANGUAGE_STORAGE_KEY)).toBe('ta');

    act(() => result.current.setLocale('en'));
    expect(window.localStorage.getItem(FALLBACK_LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('rejects setLocale with an unknown locale (silent no-op)', () => {
    const { result } = consume();
    act(() => result.current.setLocale('zz'));
    expect(result.current.locale).toBe(DEFAULT_LOCALE);
    expect(window.localStorage.getItem(FALLBACK_LANGUAGE_STORAGE_KEY)).toBeNull();
  });
});

describe('LanguageProvider — document.lang and dir updates', () => {
  it('stamps lang="en" and dir="ltr" on initial mount', () => {
    consume();
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('updates lang and dir on every locale change', () => {
    const { result } = consume();

    act(() => result.current.setLocale('hi'));
    expect(document.documentElement.lang).toBe('hi');
    expect(document.documentElement.dir).toBe('ltr');

    act(() => result.current.setLocale('ta'));
    expect(document.documentElement.lang).toBe('ta');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches dir to "rtl" for ar and he, and back to "ltr" afterwards', () => {
    const { result } = consume();

    act(() => result.current.setLocale('ar'));
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(result.current.direction).toBe('rtl');

    act(() => result.current.setLocale('he'));
    expect(document.documentElement.lang).toBe('he');
    expect(document.documentElement.dir).toBe('rtl');

    act(() => result.current.setLocale('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
});

describe('LanguageProvider — getDirection helper', () => {
  it('returns rtl for Arabic, Hebrew, Persian, and Urdu', () => {
    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('he')).toBe('rtl');
    expect(getDirection('fa')).toBe('rtl');
    expect(getDirection('ur')).toBe('rtl');
  });

  it('returns rtl for region-tagged RTL locales (ar-SA, he-IL)', () => {
    expect(getDirection('ar-SA')).toBe('rtl');
    expect(getDirection('he-IL')).toBe('rtl');
  });

  it('returns ltr for all Indian_Language_Set locales', () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(getDirection(loc)).toBe('ltr');
    }
  });

  it('returns ltr for unknown or empty locale strings', () => {
    expect(getDirection('')).toBe('ltr');
    expect(getDirection('xx')).toBe('ltr');
  });
});

describe('LanguageProvider — t() fallback chain (Requirement 18 AC 9)', () => {
  it('returns the active locale translation when present', () => {
    const { result } = consume({ defaultLocale: 'hi' });
    expect(result.current.t('common.save')).toBe('सहेजें');
  });

  it('falls back through the chain to the platform default when active locale is missing the key', () => {
    // hi catalog has `common.save` but NOT `auth.signIn`, so we should
    // reach `en` (platform default) for the latter.
    const { result } = consume({ defaultLocale: 'hi' });
    expect(result.current.t('auth.signIn')).toBe('Sign In');
  });

  it('uses tenant default before platform default when both have the key', () => {
    // Active = ar (only `common.save` present), tenant default = fr,
    // platform default = en. Both `fr` and `en` define `auth.signIn`,
    // but `fr` should win because it sits above `en` in the chain.
    const { result } = consume({
      defaultLocale: 'en',
      tenantDefaultLocale: 'fr',
      messagesByLocale: {
        en: enMessages,
        fr: frMessages,
        ar: { common: { save: 'حفظ' } },
      },
    });
    act(() => result.current.setLocale('ar'));
    expect(result.current.t('auth.signIn')).toBe('Se connecter');
  });

  it('returns the key name when the key is missing from every locale in the chain', () => {
    const { result } = consume();
    expect(result.current.t('totally.unknown.key')).toBe('totally.unknown.key');
  });

  it('interpolates ICU-style {name} placeholders in resolved translations', () => {
    const { result } = consume({
      messagesByLocale: {
        en: { dashboard: { welcome: 'Welcome back, {name}' } },
      },
    });
    expect(result.current.t('dashboard.welcome', { name: 'Asha' })).toBe('Welcome back, Asha');
  });

  it('returns the raw template when a placeholder lacks a corresponding param', () => {
    const { result } = consume({
      messagesByLocale: {
        en: { dashboard: { welcome: 'Hello {name}' } },
      },
    });
    expect(result.current.t('dashboard.welcome')).toBe('Hello {name}');
  });
});

describe('LanguageProvider — brand-aware storage key', () => {
  it('uses `${brand.shortName}-language` when wrapped in BrandConfigProvider', () => {
    const eduzoBrand: Brand = {
      ...DEFAULT_BRAND,
      name: 'EduZo',
      shortName: 'eduzo',
      slug: 'eduzo',
    };
    const { result } = consume({ brand: eduzoBrand });

    act(() => result.current.setLocale('hi'));

    const expectedKey = `eduzo${LANGUAGE_STORAGE_KEY_SUFFIX}`;
    expect(window.localStorage.getItem(expectedKey)).toBe('hi');
    expect(window.localStorage.getItem(FALLBACK_LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it('falls back to `proctira-language` when no BrandConfigProvider is in scope', () => {
    const { result } = consume();
    act(() => result.current.setLocale('ta'));
    expect(window.localStorage.getItem(FALLBACK_LANGUAGE_STORAGE_KEY)).toBe('ta');
  });

  it('honors an explicit `storageKey` prop above brand and fallback', () => {
    const eduzoBrand: Brand = {
      ...DEFAULT_BRAND,
      shortName: 'eduzo',
      slug: 'eduzo',
    };
    const { result } = consume({ brand: eduzoBrand, storageKey: 'custom-lang-key' });

    act(() => result.current.setLocale('hi'));

    expect(window.localStorage.getItem('custom-lang-key')).toBe('hi');
    expect(window.localStorage.getItem(`eduzo${LANGUAGE_STORAGE_KEY_SUFFIX}`)).toBeNull();
    expect(window.localStorage.getItem(FALLBACK_LANGUAGE_STORAGE_KEY)).toBeNull();
  });
});

describe('LanguageProvider — SSR safety', () => {
  it('renders without crashing when localStorage throws (private mode simulation)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { result } = consume();
    expect(() => act(() => result.current.setLocale('hi'))).not.toThrow();
    expect(result.current.locale).toBe('hi');

    setItemSpy.mockRestore();
  });

  it('module exports remain importable in a non-DOM context', async () => {
    const mod = await import('./LanguageProvider');
    expect(typeof mod.LanguageProvider).toBe('function');
    expect(typeof mod.useLanguage).toBe('function');
    expect(typeof mod.getDirection).toBe('function');
    expect(mod.FALLBACK_LANGUAGE_STORAGE_KEY).toBe('proctira-language');
    expect(mod.LANGUAGE_STORAGE_KEY_SUFFIX).toBe('-language');
    expect(mod.SUPPORTED_LOCALES).toEqual(['en', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn']);
    expect(mod.DEFAULT_LOCALE).toBe('en');
  });

  it('renders to a DOM container without throwing', () => {
    const { container } = render(
      <LanguageProvider messagesByLocale={{ en: enMessages }}>
        <span data-testid="probe">ok</span>
      </LanguageProvider>,
    );
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe('ok');
  });
});
