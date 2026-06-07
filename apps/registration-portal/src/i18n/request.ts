import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isValidLocale, type Locale } from './config';

/**
 * next-intl request configuration for the Registration Portal.
 *
 * Locale resolution priority:
 *   1. `locale` cookie (set by the language switcher and persisted across sessions)
 *   2. Accept-Language header
 *   3. defaultLocale (en)
 *
 * Fallback chain for messages: user locale → default locale → empty.
 */
export default getRequestConfig(async () => {
  const cookieStore = cookies();
  const headerStore = headers();

  const cookieLocale = cookieStore.get('locale')?.value;
  const acceptLanguage = headerStore.get('accept-language');
  const headerLocale = acceptLanguage?.split(',')[0]?.split('-')[0];

  let resolvedLocale: Locale = defaultLocale;
  if (cookieLocale && isValidLocale(cookieLocale)) {
    resolvedLocale = cookieLocale;
  } else if (headerLocale && isValidLocale(headerLocale)) {
    resolvedLocale = headerLocale;
  }

  let messages: IntlMessages;
  try {
    messages = (await import(`../messages/${resolvedLocale}.json`)).default;
  } catch {
    try {
      messages = (await import(`../messages/${defaultLocale}.json`)).default;
    } catch {
      messages = {};
    }
  }

  return {
    locale: resolvedLocale,
    messages,
    timeZone: 'UTC',
    now: new Date(),
  };
});

/** Recursive shape of next-intl message dictionaries */
type IntlMessages = { [key: string]: string | IntlMessages };
