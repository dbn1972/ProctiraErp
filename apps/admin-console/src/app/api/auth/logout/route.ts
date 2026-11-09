import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ADMIN_AUTH_COOKIES, clearCookieOptions } from '@/lib/auth';
import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL } from '@/lib/api/gateway';

/**
 * POST /api/auth/logout — revokes the operator's session upstream, then
 * clears all admin auth cookies.
 *
 * PRC-M464: calls the gateway's authenticated `POST /api/v1/auth/logout`
 * (Bearer access token, refresh token in the JSON body; the same contract the
 * web BFF uses, PRC-L282) so the session and refresh chain are revoked, not
 * just forgotten by this browser. Cookies are cleared even if the upstream
 * call fails.
 */
export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const accessToken = jar.get(ADMIN_AUTH_COOKIES.ACCESS_TOKEN)?.value;
  const refreshToken = jar.get(ADMIN_AUTH_COOKIES.REFRESH_TOKEN)?.value;

  if (accessToken) {
    try {
      await fetch(`${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': 'platform',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Upstream unreachable: still clear local cookies.
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, '', clearCookieOptions());
  response.cookies.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, '', clearCookieOptions());
  response.cookies.set(ADMIN_AUTH_COOKIES.SESSION_ID, '', clearCookieOptions());
  return response;
}
