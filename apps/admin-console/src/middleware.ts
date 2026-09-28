import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { isJwtFresh } from '@proctira/common/jwt';

import { ADMIN_AUTH_COOKIES } from './lib/auth/cookies';
import { isPublicPath } from './lib/auth/public-paths';
import { sanitizeReturnTo } from './lib/auth/return-to';

const TOKEN_EXPIRY_BUFFER_SECONDS = 30;

/**
 * Returns true when the JWT looks structurally valid AND its `exp` claim is
 * still in the future (with a small buffer). We do not verify the signature
 * here — the upstream auth-service does that.
 */
function isAccessTokenFresh(token: string): boolean {
  return isJwtFresh(token, TOKEN_EXPIRY_BUFFER_SECONDS);
}

/**
 * Platform Admin Console middleware: guards every protected page with a
 * cookie-based JWT check. Stamps `X-Platform-Admin: true` on the response so
 * downstream API calls can be authorised against platform-admin policies.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets and api routes.
  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.includes('.')) {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ADMIN_AUTH_COOKIES.ACCESS_TOKEN)?.value;
  if (!accessToken || !isAccessTokenFresh(accessToken)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('returnTo', sanitizeReturnTo(pathname));
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  response.headers.set('X-Platform-Admin', 'true');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
