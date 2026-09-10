import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { clearCookieOptions, getAuthServiceUrl } from '@/lib/auth/cookies';
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
  response.cookies.set(AUTH_COOKIES.ACCESS_TOKEN, '', clearCookieOptions(request));
  response.cookies.set(AUTH_COOKIES.REFRESH_TOKEN, '', clearCookieOptions(request));
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
