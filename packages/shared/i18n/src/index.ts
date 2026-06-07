/**
 * @proctira/i18n - Internationalization utilities
 *
 * Provides translation with fallback chain, locale-aware date/number/currency
 * formatting, and RTL language detection.
 */

export type {
  CurrencyFormatOptions,
  DateFormatStyle,
  I18nConfig,
  I18nService,
  LocaleInfo,
  NumberFormatOptions,
  TranslationMap,
} from './types';

export { I18nServiceImpl } from './i18n-service';
export type { I18nServiceOptions } from './i18n-service';

export { RTL_LOCALES, isRtl, getDirection } from './rtl';
