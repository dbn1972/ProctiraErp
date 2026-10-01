import { NextResponse } from 'next/server';
import { getAuthServiceUrl, readRequestCookie } from '@/lib/auth/cookies';
import { resolveTenantForRequest, TENANT_UNRESOLVED_BODY } from '@/lib/api/request-tenant';
import { AUTH_COOKIES } from '@/lib/auth/session';

/**
 * POST /api/auth/mfa/resend
 *
 * Proxies OTP resend to the auth-service (`POST /auth/mfa/resend`).
 * TOTP challenges have nothing to resend — upstream returns an error we surface honestly.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { mfaToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
  }

  const mfaToken =
    body.mfaToken?.trim() || readRequestCookie(request, AUTH_COOKIES.MFA_CHALLENGE) || '';
  if (!mfaToken) {
    return NextResponse.json({ message: 'MFA session is missing.' }, { status: 400 });
  }

  // PRC-H027: tenant comes from the Host, never from a client header.
  const tenantId = resolveTenantForRequest(request);
  if (!tenantId) {
    return NextResponse.json(TENANT_UNRESOLVED_BODY, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${getAuthServiceUrl()}/auth/mfa/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId,
      },
      body: JSON.stringify({ mfaToken }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { message: 'Authentication service is unavailable.' },
      { status: 503 },
    );
  }

  const data = (await safeJson(upstream)) as { message?: string; code?: string };
  if (!upstream.ok) {
    return NextResponse.json(
      {
        message:
          data.message ||
          'Unable to resend a code for this sign-in method. Use your authenticator app, or sign in again.',
      },
      { status: upstream.status },
    );
  }

  return NextResponse.json({ success: true, message: data.message ?? 'Code resent.' });
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
