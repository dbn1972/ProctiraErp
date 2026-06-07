import { NextResponse } from 'next/server';

import {
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  getAuthServiceUrl,
  ADMIN_AUTH_COOKIES,
} from '@/lib/auth';

/**
 * POST /api/auth/login (admin-console)
 *
 * Forwards email/password credentials to the upstream auth-service with
 * `tenantId: 'platform'`, then stores the issued access + refresh tokens
 * as httpOnly cookies (`admin_access_token` / `admin_refresh_token`) so they
 * are isolated from tenant-facing apps running on the same browser.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
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

  let upstream: Response;
  try {
    upstream = await fetch(`${getAuthServiceUrl()}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': 'platform',
        'X-Platform-Admin': 'true',
      },
      body: JSON.stringify({ username: email, password, tenantId: 'platform' }),
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
    session?: { id: string };
    message?: string;
  };

  if (!upstream.ok) {
    return NextResponse.json(
      { message: data.message || 'Invalid email or password.' },
      { status: upstream.status },
    );
  }

  if (!data.tokens) {
    return NextResponse.json(
      { message: 'Authentication response missing tokens.' },
      { status: 502 },
    );
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
