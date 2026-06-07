/**
 * Internationalization configuration for the web application.
 * Defines supported locales, default locale, and RTL languages.
 *
 * The Indian_Language_Set (Requirement 18) is the primary set of supported
 * locales: en, hi, ta, te, mr, bn, gu, kn. Additional locales (ar, fr, es, he)
 * are supported for RTL testing and future expansion.
 */

export const defaultLocale = 'en';

/**
 * All supported locales. The Indian_Language_Set forms the core:
 * en (English), hi (Hindi), ta (Tamil), te (Telugu),
 * mr (Marathi), bn (Bengali), gu (Gujarati), kn (Kannada).
 * Additional: ar (Arabic), fr (French), es (Spanish), he (Hebrew).
 */
export const locales = [
  'en',
  'hi',
  'ta',
  'te',
  'mr',
  'bn',
  'gu',
  'kn',
  'ar',
] as const;

export type Locale = (typeof locales)[number];

/** Locales that use right-to-left text direction */
export const rtlLocales: ReadonlySet<string> = new Set(['ar', 'he']);

/**
 * Returns the text direction for a given locale.
 */
export function getDirection(locale: string): 'ltr' | 'rtl' {
  return rtlLocales.has(locale) ? 'rtl' : 'ltr';
}

/**
 * Validates whether a locale string is a supported locale.
 */
export function isValidLocale(locale: string): locale is Locale {
  return (locales as readonly string[]).includes(locale);
}
