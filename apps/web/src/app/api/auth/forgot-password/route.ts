import { NextResponse } from 'next/server';
import { getAuthServiceUrl } from '@/lib/auth/cookies';

/**
 * POST /api/auth/forgot-password
 *
 * Forwards the password-reset request to the upstream auth-service. We
 * intentionally always return 200 to the client even when the email is
 * unknown — this prevents user enumeration. The auth-service still emits
 * the reset email when the address is valid.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: 'Invalid request body.' },
      { status: 400 },
    );
  }

  const { email } = body;
  if (!email) {
    return NextResponse.json(
      { message: 'Email is required.' },
      { status: 400 },
    );
  }

  const tenantId = request.headers.get('x-tenant-id') ?? 'default';

  try {
    await fetch(`${getAuthServiceUrl()}/auth/forgot-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId,
      },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });
  } catch {
    // Swallow — we still tell the user the email is on its way to avoid
    // exposing infrastructure status.
  }

  return NextResponse.json({ success: true });
}
