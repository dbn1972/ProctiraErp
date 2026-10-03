import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { ADMIN_AUTH_COOKIES } from './lib/auth/cookies';
import { decodeJwtPayload } from './lib/auth/jwt-payload';
import { isPublicPath } from './lib/auth/public-paths';
import { sanitizeReturnTo } from './lib/auth/return-to';
import { buildContentSecurityPolicy, createNonce } from './lib/security-headers';

const TOKEN_EXPIRY_BUFFER_SECONDS = 30;

/**
 * Returns true when the JWT looks structurally valid AND its `exp` claim is
 * still in the future (with a small buffer). We do not verify the signature
 * here — the upstream auth-service does that.
 */
function isAccessTokenFresh(token: string): boolean {
  // PRC-H112: base64url + UTF-8 safe decode (atob rejected '-'/'_' and mangled non-ASCII).
  const payload = decodeJwtPayload<{ exp?: number }>(token);
  if (!payload) return false;
  if (!payload.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp - TOKEN_EXPIRY_BUFFER_SECONDS > now;
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
 * cookie-based JWT check and sets the nonce CSP (PRC-M003). The platform-admin
 * marker is a server-side request header set by gatewayFetch, never a response
 * header (PRC-M003).
 */
export function middleware(request: NextRequest) {
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
  if (!accessToken || !isAccessTokenFresh(accessToken)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('returnTo', sanitizeReturnTo(pathname));
    return withCsp(request, () => NextResponse.redirect(loginUrl));
  }
  return withCsp(request, next);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
