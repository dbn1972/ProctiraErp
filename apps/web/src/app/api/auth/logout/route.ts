import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  clearCookieOptions,
  clearRefreshTokenCookieOptions,
  getGatewayUrl,
} from '@/lib/auth/cookies';
import { AUTH_COOKIES, decodeTokenPayload } from '@/lib/auth/session';
import { resolveTenantForRequest } from '@/lib/api/request-tenant';

/**
 * POST /api/auth/logout
 *
 * Notifies the upstream auth-service so it can invalidate the session and
 * revoke refresh tokens, then clears all auth cookies on the response. The
 * client is expected to navigate to /login after calling this route.
 *
 * PRC-L282: uses the gateway's authenticated `POST /api/v1/auth/logout` (Bearer
 * access token, refresh token in the JSON body — never in a query string) instead
 * of the unauthenticated GET redirect endpoint.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  const accessToken = jar.get(AUTH_COOKIES.ACCESS_TOKEN)?.value;
  const refreshToken = jar.get(AUTH_COOKIES.REFRESH_TOKEN)?.value;
  // PRC-H027: tenant comes from the Host, never from a client header. When the
  // Host does not resolve (localhost / bare domain without a fallback slug) we
  // fall back to the access token's own tenant claim so upstream revocation
  // still happens. The claim is read unverified here; that is safe because the
  // auth service verifies the bearer token and rejects a mismatched tenant.
  const tenantId =
    resolveTenantForRequest(request) ??
    (accessToken ? decodeTokenPayload(accessToken)?.tenantId?.trim() || null : null);

  if (accessToken && tenantId) {
    try {
      await fetch(new URL('/api/v1/auth/logout', getGatewayUrl()).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        cache: 'no-store',
      });
    } catch {
      // Even if the upstream call fails, we still clear local cookies.
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_COOKIES.ACCESS_TOKEN, '', clearCookieOptions(request));
  response.cookies.set(AUTH_COOKIES.REFRESH_TOKEN, '', clearRefreshTokenCookieOptions(request));
  response.cookies.set(AUTH_COOKIES.SESSION_ID, '', clearCookieOptions(request));
  return response;
}

/**
 * Allow GET as a fallback so that <a href="/api/auth/logout"> works as a
 * graceful degradation when JavaScript is disabled.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const result = await POST(request);
  // Convert the JSON success response into a redirect to /login.
  const redirect = NextResponse.redirect(new URL('/login', request.url));
  // Copy cookie clears across.
  result.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie.name, cookie.value, {
      ...cookie,
      // Preserve the cookie clearing options.
    });
  });
  return redirect;
}
