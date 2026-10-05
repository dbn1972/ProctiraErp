import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_TENANT_TIMEZONE } from '@/lib/datetime/tenant-zoned';
import { defaultLocale, isValidLocale, type Locale } from './config';

/** Cookie the middleware / LanguageProvider use for the preferred locale. */
export const LOCALE_COOKIE = 'locale';

/**
 * PRC-M492: there is no `[locale]` segment or next-intl middleware, so
 * `requestLocale` is usually undefined. Resolve the locale the same way the
 * middleware does: explicit request locale → `locale` cookie →
 * Accept-Language primary tag → default.
 */
export function resolveRequestLocale(input: {
  requested?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (input.requested && isValidLocale(input.requested)) return input.requested;
  if (input.cookie && isValidLocale(input.cookie)) return input.cookie;
  const primary = input.acceptLanguage?.split(',')[0]?.split('-')[0]?.trim();
  if (primary && isValidLocale(primary)) return primary;
  return defaultLocale;
}

/**
 * PRC-M492: tenant IANA timezone for server-side formatting. Only asks the
 * gateway when the request is authenticated; anonymous pages use the
 * platform default (Asia/Kolkata) instead of UTC.
 */
async function resolveRequestTimeZone(hasSession: boolean): Promise<string> {
  if (!hasSession) return DEFAULT_TENANT_TIMEZONE;
  try {
    const { resolveTenantTimezone } = await import('@/lib/datetime/tenant-timezone.server');
    return await resolveTenantTimezone();
  } catch {
    return DEFAULT_TENANT_TIMEZONE;
  }
}

/**
 * next-intl request configuration.
 * Loads messages for the current locale with fallback chain:
 * user locale → default locale → key name
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const resolvedLocale = resolveRequestLocale({
    requested: await requestLocale,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  });
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
  const timeZone = await resolveRequestTimeZone(Boolean(cookieStore.get('access_token')?.value));
  return {
    locale: resolvedLocale,
    messages,
    timeZone,
    now: new Date(),
  };
});
/** Type declaration for message files */
type IntlMessages = Record<string, Record<string, string> | string>;
