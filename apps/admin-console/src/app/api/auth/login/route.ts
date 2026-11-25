import { NextResponse } from 'next/server';

import {
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  getAuthServiceUrl,
  ADMIN_AUTH_COOKIES,
} from '@/lib/auth';
import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL } from '@/lib/api/gateway';

/**
 * POST /api/auth/login (admin-console)
 *
 * Forwards email/password credentials to the upstream auth-service with
 * `tenantId: 'platform'`, then stores the issued access + refresh tokens
 * as httpOnly cookies (`admin_access_token` / `admin_refresh_token`) so they
 * are isolated from tenant-facing apps running on the same browser.
 *
 * UATENV-D23: in Keycloak mode the gateway serves the password grant at
 * `POST /api/v1/auth/password` (tokens at the top level) and the platform
 * `/auth/login` is not public, so the form got 401 and no cookie was set. The
 * route tries the Keycloak route first, as the web BFF does (UATENV-D08). A
 * gateway without Keycloak does not serve it: the path is unrouted
 * (404/405/501) or proxied to an absent auth upstream (502). Only then is the
 * platform `/auth/login` used. Every Keycloak-route answer, including a
 * credential rejection, is final. The middleware still accepts only a token
 * whose tenant claim is `platform` (`verified-token.ts`).
 */
const KEYCLOAK_ROUTE_ABSENT: ReadonlySet<number> = new Set([404, 405, 501, 502]);
export async function POST(request: Request): Promise<NextResponse> {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ message: 'Email and password are required.' }, { status: 400 });
  }

  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': 'platform',
      'X-Platform-Admin': 'true',
    },
    body: JSON.stringify({ username: email, password, tenantId: 'platform' }),
    cache: 'no-store',
  };

  let upstream: Response;
  let keycloak = true;
  try {
    upstream = await fetch(`${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/auth/password`, init);
    if (KEYCLOAK_ROUTE_ABSENT.has(upstream.status)) {
      keycloak = false;
      upstream = await fetch(`${getAuthServiceUrl()}/auth/login`, init);
    }
  } catch {
    return NextResponse.json(
      {
        message: 'The authentication service is currently unavailable. Please try again shortly.',
      },
      { status: 503 },
    );
  }

  const data = (await safeJson(upstream)) as {
    tokens?: { accessToken: string; refreshToken?: string; expiresIn?: number };
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    session?: { id: string };
    message?: string;
  };

  if (!upstream.ok) {
    return NextResponse.json(
      { message: data.message || 'Invalid email or password.' },
      { status: upstream.status },
    );
  }

  const tokens = keycloak
    ? data.accessToken
      ? {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresIn: data.expiresIn,
        }
      : undefined
    : data.tokens;
  if (!tokens) {
    return NextResponse.json(
      { message: 'Authentication response missing tokens.' },
      { status: 502 },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(
    ADMIN_AUTH_COOKIES.ACCESS_TOKEN,
    tokens.accessToken,
    accessTokenCookieOptions(tokens.expiresIn),
  );
  if (tokens.refreshToken) {
    response.cookies.set(
      ADMIN_AUTH_COOKIES.REFRESH_TOKEN,
      tokens.refreshToken,
      refreshTokenCookieOptions(),
    );
  }
  if (data.session?.id) {
    response.cookies.set(
      ADMIN_AUTH_COOKIES.SESSION_ID,
      data.session.id,
      accessTokenCookieOptions(),
    );
  }
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
