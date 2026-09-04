/**
 * Internationalization configuration for the web application.
 *
 * The platform is multi-country. India is the first implemented market,
 * so the Indian language set is the default locale list. Additional
 * locales (ar) stay available for planned countries and RTL testing.
 */
import { requireCountry } from '@proctira/common';

const india = requireCountry('IN');

export const defaultLocale = india.defaultLocale;

/**
 * India locales first, then extras used by planned countries / RTL pilots.
 */
export const locales = [...india.locales, 'ar'] as const;

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
