/**
 * @proctira/i18n - Type definitions for internationalization
 */

/** Nested key-value structure for translations */
export type TranslationMap = {
  [key: string]: string | TranslationMap;
};

/** Configuration for the i18n service */
export interface I18nConfig {
  /** List of supported locale codes (e.g., ['en', 'ar', 'fr']) */
  supportedLocales: string[];
  /** Default locale used as platform-level fallback */
  defaultLocale: string;
  /** Fallback locale used when tenant default is missing a key */
  fallbackLocale: string;
  /** Optional tenant default locale (overrides platform default in fallback chain) */
  tenantDefaultLocale?: string;
}

/** Information about a supported locale */
export interface LocaleInfo {
  code: string;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
}

/** Options for number formatting */
export interface NumberFormatOptions {
  style?: 'decimal' | 'percent' | 'unit';
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
}

/** Options for currency formatting */
export interface CurrencyFormatOptions {
  display?: 'symbol' | 'narrowSymbol' | 'code' | 'name';
}

/** Date formatting style */
export type DateFormatStyle = 'short' | 'medium' | 'long' | 'full';

/** The core i18n service interface */
export interface I18nService {
  /** Translate a key with optional parameter interpolation */
  translate(key: string, params?: Record<string, string>): string;
  /** Set the current user locale */
  setLocale(locale: string): void;
  /** Get the current user locale */
  getLocale(): string;
  /** Format a date according to the current locale */
  formatDate(date: Date, style?: DateFormatStyle): string;
  /** Format a number according to the current locale */
  formatNumber(value: number, options?: NumberFormatOptions): string;
  /** Format a currency amount according to the current locale */
  formatCurrency(amount: number, currency: string, options?: CurrencyFormatOptions): string;
  /** Get the text direction for the current locale */
  getDirection(): 'ltr' | 'rtl';
  /** Get all available locales */
  getAvailableLocales(): LocaleInfo[];
}
