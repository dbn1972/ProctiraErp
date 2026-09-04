import { NextResponse } from 'next/server';
import { getAuthServiceUrl } from '@/lib/auth/cookies';

/**
 * POST /api/auth/mfa/resend
 *
 * Re-sends an SMS OTP for an existing MFA challenge token.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { mfaToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid request body.' },
      { status: 400 },
    );
  }

  const mfaToken = body.mfaToken?.trim();
  if (!mfaToken) {
    return NextResponse.json(
      { message: 'mfaToken is required.' },
      { status: 400 },
    );
  }

  const tenantId = request.headers.get('x-tenant-id') ?? 'default';

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

  const data = (await safeJson(upstream)) as Record<string, unknown>;
  if (!upstream.ok) {
    return NextResponse.json(
      {
        message:
          (data['message'] as string | undefined) ||
          'Unable to resend verification code.',
      },
      { status: upstream.status },
    );
  }

  return NextResponse.json(data);
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
