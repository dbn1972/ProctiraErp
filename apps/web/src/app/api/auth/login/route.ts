import { NextResponse } from 'next/server';
import {
  accessTokenCookieOptions,
  getAuthServiceUrl,
  getGatewayUrl,
  refreshTokenCookieOptions,
} from '@/lib/auth/cookies';
import { AUTH_COOKIES } from '@/lib/auth/session';

/**
 * POST /api/auth/login
 *
 * When Keycloak is configured, verifies email/password against Keycloak via
 * the gateway (`/api/v1/auth/password`) and stores tokens in httpOnly cookies.
 * The browser never leaves the Proctira login page.
 *
 * Falls back to the legacy auth-service when Keycloak env is absent.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid request body.' },
      { status: 400 },
    );
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json(
      { message: 'Email and password are required.' },
      { status: 400 },
    );
  }

  const keycloakEnabled = Boolean(
    process.env['KEYCLOAK_ISSUER'] || process.env['KEYCLOAK_CLIENT_ID'],
  );

  if (keycloakEnabled) {
    return loginWithKeycloak(email, password);
  }

  return loginWithLegacyAuth(email, password, request.headers.get('x-tenant-id') ?? 'default');
}

async function loginWithKeycloak(
  email: string,
  password: string,
): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(`${getGatewayUrl()}/api/v1/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      {
        message:
          'The authentication service is currently unavailable. Please try again shortly.',
      },
      { status: 503 },
    );
  }

  const data = (await safeJson(upstream)) as {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    message?: string;
    code?: string;
  };

  if (!upstream.ok || !data.accessToken) {
    return NextResponse.json(
      {
        message: data.message || 'Invalid email or password.',
        code: data.code,
      },
      { status: upstream.status === 200 ? 401 : upstream.status },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(
    AUTH_COOKIES.ACCESS_TOKEN,
    data.accessToken,
    accessTokenCookieOptions(data.expiresIn ?? 300),
  );
  if (data.refreshToken) {
    response.cookies.set(
      AUTH_COOKIES.REFRESH_TOKEN,
      data.refreshToken,
      refreshTokenCookieOptions(),
    );
  }
  return response;
}

async function loginWithLegacyAuth(
  email: string,
  password: string,
  tenantId: string,
): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(`${getAuthServiceUrl()}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId,
      },
      body: JSON.stringify({ username: email, password }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      {
        message:
          'The authentication service is currently unavailable. Please try again shortly.',
      },
      { status: 503 },
    );
  }

  const data = (await safeJson(upstream)) as {
    tokens?: { accessToken: string; refreshToken: string; expiresIn: number };
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

  if (data.requiresMfa) {
    return NextResponse.json({
      requiresMfa: true,
      mfaToken: data.mfaToken,
    });
  }

  if (!data.tokens) {
    return NextResponse.json(
      { message: 'Authentication response missing tokens.' },
      { status: 502 },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(
    AUTH_COOKIES.ACCESS_TOKEN,
    data.tokens.accessToken,
    accessTokenCookieOptions(data.tokens.expiresIn),
  );
  response.cookies.set(
    AUTH_COOKIES.REFRESH_TOKEN,
    data.tokens.refreshToken,
    refreshTokenCookieOptions(),
  );
  if (data.session?.id) {
    response.cookies.set(
      AUTH_COOKIES.SESSION_ID,
      data.session.id,
      accessTokenCookieOptions(),
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
