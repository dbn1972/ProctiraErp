import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clearCookieOptions, getAuthServiceUrl, getGatewayUrl } from '@/lib/auth/cookies';
import { AUTH_COOKIES } from '@/lib/auth/session';

/**
 * POST /api/auth/logout
 *
 * Notifies the upstream auth-service so it can invalidate the session and
 * revoke refresh tokens, then clears all auth cookies on the response. The
 * client is expected to navigate to /login after calling this route.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  const accessToken = jar.get(AUTH_COOKIES.ACCESS_TOKEN)?.value;
  const tenantId = request.headers.get('x-tenant-id') ?? 'default';

  if (accessToken) {
    try {
      await fetch(`${getAuthServiceUrl()}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId,
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      });
    } catch {
      // Even if the upstream call fails, we still clear local cookies.
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_COOKIES.ACCESS_TOKEN, '', clearCookieOptions());
  response.cookies.set(AUTH_COOKIES.REFRESH_TOKEN, '', clearCookieOptions());
  response.cookies.set(AUTH_COOKIES.SESSION_ID, '', clearCookieOptions());
  return response;
}

/**
 * Allow GET as a fallback so that <a href="/api/auth/logout"> works as a
 * graceful degradation when JavaScript is disabled.
 */
export async function GET(request: Request): Promise<NextResponse> {
  await POST(request);
  const loginUrl = new URL('/login', request.url).toString();
  const keycloakEnabled = Boolean(
    process.env['KEYCLOAK_ISSUER'] || process.env['KEYCLOAK_CLIENT_ID'],
  );
  const redirect = NextResponse.redirect(
    keycloakEnabled
      ? `${getGatewayUrl()}/api/v1/auth/logout?redirect=${encodeURIComponent(loginUrl)}`
      : loginUrl,
  );
  redirect.cookies.set(AUTH_COOKIES.ACCESS_TOKEN, '', clearCookieOptions());
  redirect.cookies.set(AUTH_COOKIES.REFRESH_TOKEN, '', clearCookieOptions());
  redirect.cookies.set(AUTH_COOKIES.SESSION_ID, '', clearCookieOptions());
  return redirect;
}
