export const locales = ['en', 'ar'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

const rtlLocales: Locale[] = ['ar'];

export function getDirection(locale: string): 'ltr' | 'rtl' {
  return rtlLocales.includes(locale as Locale) ? 'rtl' : 'ltr';
}
