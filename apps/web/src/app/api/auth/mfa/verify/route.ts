import { NextResponse } from 'next/server';
import {
  accessTokenCookieOptions,
  getAuthServiceUrl,
  refreshTokenCookieOptions,
} from '@/lib/auth/cookies';
import { AUTH_COOKIES } from '@/lib/auth/session';

/**
 * POST /api/auth/mfa/verify
 *
 * Verifies a 6-digit MFA code. On success, the upstream auth-service issues
 * the final access + refresh token pair which we persist as httpOnly cookies.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { mfaToken?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid request body.' },
      { status: 400 },
    );
  }

  const { mfaToken, code } = body;
  if (!mfaToken || !code) {
    return NextResponse.json(
      { message: 'Verification code is required.' },
      { status: 400 },
    );
  }

  const tenantId = request.headers.get('x-tenant-id') ?? 'default';

  let upstream: Response;
  try {
    upstream = await fetch(`${getAuthServiceUrl()}/auth/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId,
      },
      body: JSON.stringify({ mfaToken, code }),
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
    session?: { id: string };
    message?: string;
  };

  if (!upstream.ok || !data.tokens) {
    return NextResponse.json(
      { message: data.message || 'Invalid or expired verification code.' },
      { status: upstream.status === 200 ? 502 : upstream.status },
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
