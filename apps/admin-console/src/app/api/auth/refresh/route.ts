import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  ADMIN_AUTH_COOKIES,
  accessTokenCookieOptions,
  clearCookieOptions,
  getAuthServiceUrl,
  refreshTokenCookieOptions,
} from '@/lib/auth';

/**
 * POST /api/auth/refresh (admin-console) — PRC-M464.
 *
 * Rotates the operator's tokens with the upstream auth service
 * (`POST /auth/refresh`, body `{ refreshToken }`, response `{ tokens }`, the
 * same contract the web BFF uses) for the platform tenant. On failure every
 * admin cookie is cleared and 401 is returned so the caller signs in again.
 */
export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const refreshToken = jar.get(ADMIN_AUTH_COOKIES.REFRESH_TOKEN)?.value;
  if (!refreshToken) {
    return NextResponse.json({ message: 'No refresh token present.' }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${getAuthServiceUrl()}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': 'platform',
        'X-Platform-Admin': 'true',
      },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { message: 'Authentication service is unavailable.' },
      { status: 503 },
    );
  }

  const data = (await safeJson(upstream)) as {
    tokens?: { accessToken?: string; refreshToken?: string; expiresIn?: number };
  };
  if (!upstream.ok || !data.tokens?.accessToken || !data.tokens.refreshToken) {
    const failure = NextResponse.json({ message: 'Refresh failed.' }, { status: 401 });
    failure.cookies.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, '', clearCookieOptions());
    failure.cookies.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, '', clearCookieOptions());
    failure.cookies.set(ADMIN_AUTH_COOKIES.SESSION_ID, '', clearCookieOptions());
    return failure;
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(
    ADMIN_AUTH_COOKIES.ACCESS_TOKEN,
    data.tokens.accessToken,
    accessTokenCookieOptions(data.tokens.expiresIn),
  );
  response.cookies.set(
    ADMIN_AUTH_COOKIES.REFRESH_TOKEN,
    data.tokens.refreshToken,
    refreshTokenCookieOptions(),
  );
  return response;
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
