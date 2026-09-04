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
 * Verifies a 6-digit MFA code. When `method` is `sms` (or omitted for SMS
 * challenges), the upstream auth-service validates against the hashed OTP
 * store. On success with tokens, cookies are set; otherwise `{ success: true }`
 * is returned for the Keycloak path where the challenge is a gate only.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { mfaToken?: string; code?: string; method?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid request body.' },
      { status: 400 },
    );
  }

  const { mfaToken, code } = body;
  const method = (body.method ?? 'sms').toLowerCase();
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
      body: JSON.stringify({ mfaToken, code, method }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { message: 'Authentication service is unavailable.' },
      { status: 503 },
    );
  }

  const data = (await safeJson(upstream)) as {
    success?: boolean;
    tokens?: { accessToken: string; refreshToken: string; expiresIn: number };
    session?: { id: string };
    message?: string;
  };

  if (!upstream.ok) {
    return NextResponse.json(
      { message: data.message || 'Invalid or expired verification code.' },
      { status: upstream.status },
    );
  }

  if (data.tokens) {
    const response = NextResponse.json({ success: true, method });
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

  return NextResponse.json({ success: true, method });
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
