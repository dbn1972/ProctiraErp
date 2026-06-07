/**
 * Internationalization configuration for the Registration Portal.
 *
 * Required by spec: English, Spanish, French, Arabic (Arabic is RTL).
 * Hebrew is included for parity with the rest of the ProctiraERP platform.
 */

export const defaultLocale = 'en';

export const locales = ['en', 'es', 'fr', 'ar', 'he'] as const;

export type Locale = (typeof locales)[number];

/** Locales that use right-to-left text direction */
export const rtlLocales: ReadonlySet<string> = new Set(['ar', 'he']);

/** Returns the text direction for a given locale */
export function getDirection(locale: string): 'ltr' | 'rtl' {
  return rtlLocales.has(locale) ? 'rtl' : 'ltr';
}

/** Returns true when the supplied string is a supported locale */
export function isValidLocale(locale: string): locale is Locale {
  return (locales as readonly string[]).includes(locale);
}
