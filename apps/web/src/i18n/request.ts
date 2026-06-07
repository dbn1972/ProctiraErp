import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isValidLocale } from './config';

/**
 * next-intl request configuration.
 * Loads messages for the current locale with fallback chain:
 * user locale → default locale → key name
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const resolvedLocale =
    requested && isValidLocale(requested) ? requested : defaultLocale;

  let messages: IntlMessages;
  try {
    messages = (await import(`../messages/${resolvedLocale}.json`)).default;
  } catch {
    // Fallback to default locale if requested locale messages are missing
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

/** Type declaration for message files */
type IntlMessages = Record<string, Record<string, string> | string>;
