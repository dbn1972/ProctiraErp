import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { defaultLocale, isValidLocale, getDirection } from './i18n/config';

/** Cookie name for the user's preferred locale */
const LOCALE_COOKIE = 'locale';

/**
 * Next.js middleware for the registration portal.
 * This is a public-facing app — no authentication required.
 * Handles:
 * 1. Locale detection and direction setting
 * 2. Language persistence via cookie
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next();

  // --- Locale Resolution ---
  const localeCookie = request.cookies.get(LOCALE_COOKIE)?.value;
  const acceptLanguage = request.headers.get('accept-language')?.split(',')[0]?.split('-')[0];
  const locale = (localeCookie && isValidLocale(localeCookie))
    ? localeCookie
    : (acceptLanguage && isValidLocale(acceptLanguage))
      ? acceptLanguage
      : defaultLocale;

  const direction = getDirection(locale);
  response.headers.set('X-Locale', locale);
  response.headers.set('X-Direction', direction);

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
