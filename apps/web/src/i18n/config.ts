/**
 * Internationalization configuration for the web application.
 * Defines supported locales, default locale, and RTL languages.
 *
 * The Indian_Language_Set (Requirement 18) is the primary set of supported
 * locales: en, hi, ta, te, mr, bn, gu, kn. Arabic (`ar`) is also supported
 * for RTL. Direction helpers for other RTL scripts (e.g. Hebrew) live in
 * `LanguageProvider` — only locales with a `messages/<locale>.json` file
 * belong in `locales` / `rtlLocales` here (G-721).
 */

export const defaultLocale = 'en';

/**
 * All supported locales. The Indian_Language_Set forms the core:
 * en (English), hi (Hindi), ta (Tamil), te (Telugu),
 * mr (Marathi), bn (Bengali), gu (Gujarati), kn (Kannada).
 * Additional: ar (Arabic) — has `messages/ar.json`.
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

/**
 * Locales that use right-to-left text direction and ship message files.
 * Keep this set a subset of {@link locales} (G-721 — no orphan RTL codes).
 */
export const rtlLocales: ReadonlySet<string> = new Set(['ar']);

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
