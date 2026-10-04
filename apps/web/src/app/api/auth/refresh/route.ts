import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  accessTokenCookieOptions,
  clearCookieOptions,
  clearRefreshTokenCookieOptions,
  getAuthServiceUrl,
  refreshTokenCookieOptions,
} from '@/lib/auth/cookies';
import { AUTH_COOKIES } from '@/lib/auth/session';
import { resolveTenantForRequest, TENANT_UNRESOLVED_BODY } from '@/lib/api/request-tenant';

/**
 * POST /api/auth/refresh
 *
 * Reads the refresh token from the httpOnly cookie, calls the upstream
 * auth-service `/auth/refresh` endpoint, and rotates both cookies on
 * success. On failure, all auth cookies are cleared and a 401 is returned
 * so the caller can redirect to /login.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  const refreshToken = jar.get(AUTH_COOKIES.REFRESH_TOKEN)?.value;

  if (!refreshToken) {
    return NextResponse.json({ message: 'No refresh token present.' }, { status: 401 });
  }

  // PRC-H027: tenant comes from the Host, never from a client header.
  const tenantId = resolveTenantForRequest(request);
  if (!tenantId) {
    return NextResponse.json(TENANT_UNRESOLVED_BODY, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${getAuthServiceUrl()}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId,
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
    tokens?: { accessToken: string; refreshToken: string; expiresIn: number };
    message?: string;
  };

  if (!upstream.ok || !data.tokens) {
    const failure = NextResponse.json(
      { message: data.message || 'Refresh failed.' },
      { status: 401 },
    );
    failure.cookies.set(AUTH_COOKIES.ACCESS_TOKEN, '', clearCookieOptions(request));
    failure.cookies.set(AUTH_COOKIES.REFRESH_TOKEN, '', clearRefreshTokenCookieOptions(request));
    failure.cookies.set(AUTH_COOKIES.SESSION_ID, '', clearCookieOptions(request));
    return failure;
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(
    AUTH_COOKIES.ACCESS_TOKEN,
    data.tokens.accessToken,
    accessTokenCookieOptions(data.tokens.expiresIn, request),
  );
  response.cookies.set(
    AUTH_COOKIES.REFRESH_TOKEN,
    data.tokens.refreshToken,
    refreshTokenCookieOptions(undefined, request),
  );
  return response;
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
