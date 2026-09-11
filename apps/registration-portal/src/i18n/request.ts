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
  const cookieStore = await cookies();
  const headerStore = await headers();

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
    messages = await loadMessages(resolvedLocale);
  } catch {
    try {
      messages = await loadMessages(defaultLocale);
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

async function loadMessages(locale: string): Promise<IntlMessages> {
  const mod: unknown = await import(`../messages/${locale}.json`);
  if (typeof mod !== 'object' || mod === null || !('default' in mod)) {
    return {};
  }
  const value = Reflect.get(mod, 'default');
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  return value as IntlMessages;
}
