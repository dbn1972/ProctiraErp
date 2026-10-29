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
  if (!claims || !isAccessTokenFresh(claims)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('returnTo', sanitizeReturnTo(pathname));
    return withCsp(request, () => NextResponse.redirect(loginUrl));
  }
  return withCsp(request, next);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
