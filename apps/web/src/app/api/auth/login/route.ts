import { NextResponse } from 'next/server';
import {
  accessTokenCookieOptions,
  getAuthServiceUrl,
  getGatewayUrl,
  mfaChallengeCookieOptions,
  refreshTokenCookieOptions,
} from '@/lib/auth/cookies';
import { AUTH_COOKIES } from '@/lib/auth/session';
import { resolveTenantForRequest, TENANT_UNRESOLVED_BODY } from '@/lib/api/request-tenant';

/**
 * POST /api/auth/login
 *
 * Forwards email/password credentials to the upstream auth-service. On
 * success the issued access + refresh tokens are stored in httpOnly cookies
 * so they are never exposed to client-side JavaScript.
 *
 * If the auth-service signals that MFA is required, we return
 * `{ requiresMfa: true }` without setting any session cookies. The challenge
 * token is stored in a short-lived httpOnly cookie scoped to /api/auth/mfa
 * so it never appears in the /mfa URL (PRC-L024).
 *
 * UATENV-D08: in Keycloak mode the gateway serves the password grant at
 * `POST /api/v1/auth/password` (tokens at the top level) and the platform
 * `/auth/login` is not public, so the form got 401. The route tries the
 * Keycloak route first. A gateway without Keycloak does not serve it: the path
 * is unrouted (404/405/501) or proxied to an absent auth upstream (502). Only
 * then is the platform `/auth/login` used. Every Keycloak-route answer,
 * including a credential rejection, is final.
 */
const KEYCLOAK_ROUTE_ABSENT: ReadonlySet<number> = new Set([404, 405, 501, 502]);
export async function POST(request: Request): Promise<NextResponse> {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ message: 'Email and password are required.' }, { status: 400 });
  }

  // PRC-H027: tenant comes from the Host, never from a client header.
  const tenantId = resolveTenantForRequest(request);
  if (!tenantId) {
    return NextResponse.json(TENANT_UNRESOLVED_BODY, { status: 400 });
  }

  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': tenantId,
    },
    body: JSON.stringify({ username: email, password }),
    cache: 'no-store',
  };

  let upstream: Response;
  let keycloak = true;
  try {
    upstream = await fetch(new URL('/api/v1/auth/password', getGatewayUrl()).toString(), init);
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
    requiresMfa?: boolean;
    mfaToken?: string;
    session?: { id: string; expiresAt: string };
    message?: string;
    code?: string;
  };

  if (!upstream.ok) {
    return NextResponse.json(
      {
        message: data.message || 'Invalid email or password.',
        code: data.code,
      },
      { status: upstream.status },
    );
  }

  // MFA challenge required – do not set tokens yet.
  if (data.requiresMfa) {
    if (!data.mfaToken) {
      return NextResponse.json(
        { message: 'MFA challenge missing from response.' },
        { status: 502 },
      );
    }
    const mfaResponse = NextResponse.json({ requiresMfa: true });
    mfaResponse.cookies.set(
      AUTH_COOKIES.MFA_CHALLENGE,
      data.mfaToken,
      mfaChallengeCookieOptions(undefined, request),
    );
    return mfaResponse;
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
    AUTH_COOKIES.ACCESS_TOKEN,
    tokens.accessToken,
    accessTokenCookieOptions(tokens.expiresIn, request),
  );
  if (tokens.refreshToken) {
    response.cookies.set(
      AUTH_COOKIES.REFRESH_TOKEN,
      tokens.refreshToken,
      refreshTokenCookieOptions(undefined, request),
    );
  }
  if (data.session?.id) {
    response.cookies.set(
      AUTH_COOKIES.SESSION_ID,
      data.session.id,
      accessTokenCookieOptions(undefined, request),
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
