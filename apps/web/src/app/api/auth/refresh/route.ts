import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  accessTokenCookieOptions,
  clearCookieOptions,
  getAuthServiceUrl,
  getGatewayUrl,
  refreshTokenCookieOptions,
} from '@/lib/auth/cookies';
import { AUTH_COOKIES } from '@/lib/auth/session';

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
    return NextResponse.json(
      { message: 'No refresh token present.' },
      { status: 401 },
    );
  }

  const tenantId = request.headers.get('x-tenant-id') ?? 'default';

  const keycloakEnabled = Boolean(
    process.env['KEYCLOAK_ISSUER'] || process.env['KEYCLOAK_CLIENT_ID'],
  );

  let upstream: Response;
  try {
    upstream = keycloakEnabled
      ? await fetch(`${getGatewayUrl()}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          cache: 'no-store',
        })
      : await fetch(`${getAuthServiceUrl()}/auth/refresh`, {
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
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    message?: string;
  };
  const accessToken = data.tokens?.accessToken ?? data.accessToken;
  const nextRefresh = data.tokens?.refreshToken ?? data.refreshToken;
  const expiresIn = data.tokens?.expiresIn ?? data.expiresIn;

  if (!upstream.ok || !accessToken) {
    const failure = NextResponse.json(
      { message: data.message || 'Refresh failed.' },
      { status: 401 },
    );
    failure.cookies.set(
      AUTH_COOKIES.ACCESS_TOKEN,
      '',
      clearCookieOptions(),
    );
    failure.cookies.set(
      AUTH_COOKIES.REFRESH_TOKEN,
      '',
      clearCookieOptions(),
    );
    failure.cookies.set(
      AUTH_COOKIES.SESSION_ID,
      '',
      clearCookieOptions(),
    );
    return failure;
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(
    AUTH_COOKIES.ACCESS_TOKEN,
    accessToken,
    accessTokenCookieOptions(expiresIn),
  );
  if (nextRefresh) {
    response.cookies.set(
      AUTH_COOKIES.REFRESH_TOKEN,
      nextRefresh,
      refreshTokenCookieOptions(),
    );
  }
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
