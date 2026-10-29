import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { ADMIN_AUTH_COOKIES } from './lib/auth/cookies';
import { isPublicPath } from './lib/auth/public-paths';
import { sanitizeReturnTo } from './lib/auth/return-to';
import { readPlatformToken } from './lib/auth/verified-token';
import { buildContentSecurityPolicy, createNonce } from './lib/security-headers';

const TOKEN_EXPIRY_BUFFER_SECONDS = 30;

/**
 * True when the (verified) claims' `exp` is still in the future (with a small
 * buffer). A missing `exp` only reaches here in decode-only mode (the JWKS
 * verifier refuses it) and keeps the previous behaviour: treated as fresh.
 */
function isAccessTokenFresh(claims: { exp?: unknown }): boolean {
  if (!claims.exp) return true;
  if (typeof claims.exp !== 'number') return false;
  const now = Math.floor(Date.now() / 1000);
  return claims.exp - TOKEN_EXPIRY_BUFFER_SECONDS > now;
}

/**
 * PRC-M003: attach a per-request nonce CSP to a document response. Next.js reads the CSP from
 * the forwarded request headers and stamps the nonce on its own scripts.
 */
function withCsp(request: NextRequest, build: (headers: Headers) => NextResponse): NextResponse {
  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = build(requestHeaders);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

/**
 * Platform Admin Console middleware: guards every protected page with a
 * verified platform-tenant JWT (PRC-L202) and sets the nonce CSP (PRC-M003). The platform-admin
 * marker is a server-side request header set by gatewayFetch, never a response
 * header (PRC-M003).
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets and api routes.
  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const next = (headers: Headers) => NextResponse.next({ request: { headers } });
  if (isPublicPath(pathname)) {
    return withCsp(request, next);
  }

  const accessToken = request.cookies.get(ADMIN_AUTH_COOKIES.ACCESS_TOKEN)?.value;
  // PRC-L202: only a token whose signature, issuer and audience verify against
  // the IdP JWKS, issued for the platform tenant, opens a console page.
  const claims = accessToken ? await readPlatformToken(accessToken, { ignoreExpiry: true }) : null;
  const toLogin = () => {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('returnTo', sanitizeReturnTo(pathname));
    return withCsp(request, () => NextResponse.redirect(loginUrl));
  };
  if (!claims) return toLogin();
  if (!isAccessTokenFresh(claims)) {
    // PRC-M464: an authentic but expired token is rotated with the refresh
    // token instead of forcing a new sign-in; the navigation is then replayed.
    const refreshToken = request.cookies.get(ADMIN_AUTH_COOKIES.REFRESH_TOKEN)?.value;
    const setCookies = refreshToken ? await refreshOnce(request, refreshToken) : null;
    if (!setCookies || setCookies.length === 0) return toLogin();
    const replay = NextResponse.redirect(request.url);
    setCookies.forEach((cookie) => replay.headers.append('set-cookie', cookie));
    return replay;
  }
  return withCsp(request, next);
}

/** PRC-M464: completed refreshes are reused this long by parallel navigations. */
const REFRESH_REUSE_MS = 10_000;
const refreshInFlight = new Map<string, { promise: Promise<string[] | null>; expiresAt: number }>();

/**
 * Single-flight per refresh token: parallel navigations share one call to
 * `/api/auth/refresh` (and its rotated Set-Cookie headers) instead of racing
 * the rotation and revoking each other.
 */
async function refreshOnce(request: NextRequest, refreshToken: string): Promise<string[] | null> {
  const now = Date.now();
  for (const [key, entry] of refreshInFlight) {
    if (entry.expiresAt <= now) refreshInFlight.delete(key);
  }
  const existing = refreshInFlight.get(refreshToken);
  if (existing) return existing.promise;
  const promise = (async () => {
    try {
      const response = await fetch(new URL('/api/auth/refresh', request.url), {
        method: 'POST',
        headers: { cookie: request.headers.get('cookie') ?? '' },
      });
      if (!response.ok) return null;
      const headers = response.headers as Headers & { getSetCookie?: () => string[] };
      if (headers.getSetCookie) return headers.getSetCookie();
      const single = response.headers.get('set-cookie');
      return single ? [single] : [];
    } catch {
      return null;
    }
  })();
  refreshInFlight.set(refreshToken, { promise, expiresAt: now + REFRESH_REUSE_MS });
  const outcome = await promise;
  if (!outcome) refreshInFlight.delete(refreshToken);
  return outcome;
}

/** Test hook: forget cached refresh outcomes. */
export function __resetConsoleRefreshSingleFlight(): void {
  refreshInFlight.clear();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
