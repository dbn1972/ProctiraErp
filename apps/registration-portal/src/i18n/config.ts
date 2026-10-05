/**
 * Internationalization configuration for the Registration Portal.
 *
 * Required by spec: English, Spanish, French, Arabic (Arabic is RTL).
 * A locale is listed only when `src/messages/<locale>.json` exists with full
 * key parity to en.json (PRC-M053; enforced by i18n/catalogs.test.ts).
 */

export const defaultLocale = 'en';

export const locales = ['en', 'es', 'fr', 'ar'] as const;

export type Locale = (typeof locales)[number];

/** Locales that use right-to-left text direction */
export const rtlLocales: ReadonlySet<string> = new Set(['ar']);

/** Returns the text direction for a given locale */
export function getDirection(locale: string): 'ltr' | 'rtl' {
  return rtlLocales.has(locale) ? 'rtl' : 'ltr';
}

/** Returns true when the supplied string is a supported locale */
export function isValidLocale(locale: string): locale is Locale {
  return (locales as readonly string[]).includes(locale);
}
