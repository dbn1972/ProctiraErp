/**
 * @proctira/i18n - I18nService implementation
 *
 * Provides translation with fallback chain, locale-aware formatting,
 * and RTL detection.
 */

import { isRtl } from './rtl';
import type {
  CurrencyFormatOptions,
  DateFormatStyle,
  I18nConfig,
  I18nService,
  LocaleInfo,
  NumberFormatOptions,
  TranslationMap,
} from './types';

/**
 * Resolves a nested translation key from a TranslationMap.
 * Supports dot-notation keys (e.g., "common.buttons.save").
 */
function resolveKey(map: TranslationMap, key: string): string | undefined {
  const parts = key.split('.');
  let current: TranslationMap | string | undefined = map;

  for (const part of parts) {
    if (current === undefined || typeof current === 'string') {
      return undefined;
    }
    current = current[part];
  }

  return typeof current === 'string' ? current : undefined;
}

/**
 * Interpolates parameters into a translation string.
 * Replaces {{paramName}} placeholders with provided values.
 */
function interpolate(
  template: string,
  params?: Record<string, string>,
): string {
  if (!params) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (match, paramName: string) => {
    return params[paramName] !== undefined ? params[paramName] : match;
  });
}

/** Options for creating an I18nServiceImpl instance */
export interface I18nServiceOptions {
  config: I18nConfig;
  /** Translation maps keyed by locale code */
  translations: Record<string, TranslationMap>;
  /** Optional locale metadata */
  localeInfos?: LocaleInfo[];
}

/**
 * Implementation of the I18nService interface.
 *
 * Fallback chain for translations:
 * 1. User's selected locale
 * 2. Tenant default locale (if configured)
 * 3. Platform default locale
 * 4. Key name itself (as last resort)
 */
export class I18nServiceImpl implements I18nService {
  private currentLocale: string;
  private readonly config: I18nConfig;
  private readonly translations: Record<string, TranslationMap>;
  private readonly localeInfos: LocaleInfo[];

  constructor(options: I18nServiceOptions) {
    this.config = options.config;
    this.translations = options.translations;
    this.currentLocale = options.config.defaultLocale;
    this.localeInfos = options.localeInfos ?? this.buildDefaultLocaleInfos();
  }

  translate(key: string, params?: Record<string, string>): string {
    // Fallback chain: user locale → tenant default → platform default → key name
    const localesToTry = this.buildFallbackChain();

    for (const locale of localesToTry) {
      const map = this.translations[locale];
      if (map) {
        const value = resolveKey(map, key);
        if (value !== undefined) {
          return interpolate(value, params);
        }
      }
    }

    // Last resort: return the key name itself
    return key;
  }

  setLocale(locale: string): void {
    if (this.config.supportedLocales.includes(locale)) {
      this.currentLocale = locale;
    }
  }

  getLocale(): string {
    return this.currentLocale;
  }

  formatDate(date: Date, style: DateFormatStyle = 'medium'): string {
    const options = this.getDateFormatOptions(style);
    return new Intl.DateTimeFormat(this.currentLocale, options).format(date);
  }

  formatNumber(value: number, options?: NumberFormatOptions): string {
    const intlOptions: Intl.NumberFormatOptions = {
      style: options?.style ?? 'decimal',
      minimumFractionDigits: options?.minimumFractionDigits,
      maximumFractionDigits: options?.maximumFractionDigits,
      useGrouping: options?.useGrouping,
    };
    return new Intl.NumberFormat(this.currentLocale, intlOptions).format(value);
  }

  formatCurrency(
    amount: number,
    currency: string,
    options?: CurrencyFormatOptions,
  ): string {
    const intlOptions: Intl.NumberFormatOptions = {
      style: 'currency',
      currency,
      currencyDisplay: options?.display ?? 'symbol',
    };
    return new Intl.NumberFormat(this.currentLocale, intlOptions).format(amount);
  }

  getDirection(): 'ltr' | 'rtl' {
    return isRtl(this.currentLocale) ? 'rtl' : 'ltr';
  }

  getAvailableLocales(): LocaleInfo[] {
    return this.localeInfos;
  }

  /**
   * Builds the ordered fallback chain for translation lookup.
   * Order: user locale → tenant default → platform default (fallback locale)
   * Deduplicates entries to avoid redundant lookups.
   */
  private buildFallbackChain(): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();

    const addToChain = (locale: string) => {
      if (!seen.has(locale)) {
        seen.add(locale);
        chain.push(locale);
      }
    };

    // 1. User's current locale
    addToChain(this.currentLocale);

    // 2. Tenant default locale (if configured and different)
    if (this.config.tenantDefaultLocale) {
      addToChain(this.config.tenantDefaultLocale);
    }

    // 3. Platform default / fallback locale
    addToChain(this.config.defaultLocale);
    addToChain(this.config.fallbackLocale);

    return chain;
  }

  private getDateFormatOptions(
    style: DateFormatStyle,
  ): Intl.DateTimeFormatOptions {
    switch (style) {
      case 'short':
        return { year: 'numeric', month: 'numeric', day: 'numeric' };
      case 'medium':
        return { year: 'numeric', month: 'short', day: 'numeric' };
      case 'long':
        return { year: 'numeric', month: 'long', day: 'numeric' };
      case 'full':
        return {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        };
    }
  }

  private buildDefaultLocaleInfos(): LocaleInfo[] {
    return this.config.supportedLocales.map((code) => ({
      code,
      name: code,
      nativeName: code,
      direction: isRtl(code) ? ('rtl' as const) : ('ltr' as const),
    }));
  }
}
