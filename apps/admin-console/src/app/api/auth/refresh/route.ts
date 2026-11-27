import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  ADMIN_AUTH_COOKIES,
  accessTokenCookieOptions,
  clearCookieOptions,
  getAuthServiceUrl,
  refreshTokenCookieOptions,
} from '@/lib/auth';
import { decodeJwtPayload } from '@/lib/auth/jwt-payload';
import { readPlatformToken } from '@/lib/auth/verified-token';
import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL } from '@/lib/api/gateway';

/**
 * POST /api/auth/refresh (admin-console) — PRC-M464.
 *
 * Rotates the operator's tokens with the upstream auth service
 * (`POST /auth/refresh`, body `{ refreshToken }`, response `{ tokens }`, the
 * same contract the web BFF uses) for the platform tenant. On failure every
 * admin cookie is cleared and 401 is returned so the caller signs in again.
 *
 * UATENV-D34 (web UATENV-D16): a Keycloak session (its refresh token is a JWT;
 * platform refresh tokens are opaque) refreshes through the gateway Keycloak
 * route `/api/v1/auth/refresh`, which returns the tokens at the top level.
 * Posting it to the platform `/auth/refresh` got 401, so the operator was
 * signed out when the 5-minute access token expired.
 *
 * UATENV-D30 / #790: as at sign-in, the new access token must verify as a
 * platform-tenant token before any cookie is set; otherwise the refresh fails.
 */
export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const refreshToken = jar.get(ADMIN_AUTH_COOKIES.REFRESH_TOKEN)?.value;
  if (!refreshToken) {
    return NextResponse.json({ message: 'No refresh token present.' }, { status: 401 });
  }

  const keycloakSession = decodeJwtPayload(refreshToken) !== null;
  const refreshUrl = keycloakSession
    ? `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/auth/refresh`
    : `${getAuthServiceUrl()}/auth/refresh`;

  let upstream: Response;
  try {
    upstream = await fetch(refreshUrl, {
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
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  };
  const tokens = keycloakSession
    ? data.accessToken
      ? {
          accessToken: data.accessToken,
          // Keycloak always rotates it; keep the presented one if it did not.
          refreshToken: data.refreshToken || refreshToken,
          expiresIn: data.expiresIn,
        }
      : undefined
    : data.tokens;
  if (
    !upstream.ok ||
    !tokens?.accessToken ||
    !tokens.refreshToken ||
    !(await readPlatformToken(tokens.accessToken))
  ) {
    const failure = NextResponse.json({ message: 'Refresh failed.' }, { status: 401 });
    failure.cookies.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, '', clearCookieOptions());
    failure.cookies.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, '', clearCookieOptions());
    failure.cookies.set(ADMIN_AUTH_COOKIES.SESSION_ID, '', clearCookieOptions());
    return failure;
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(
    ADMIN_AUTH_COOKIES.ACCESS_TOKEN,
    tokens.accessToken,
    accessTokenCookieOptions(tokens.expiresIn),
  );
  response.cookies.set(
    ADMIN_AUTH_COOKIES.REFRESH_TOKEN,
    tokens.refreshToken,
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
