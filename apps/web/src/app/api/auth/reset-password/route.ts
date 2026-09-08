import { NextResponse } from 'next/server';
import { getAuthServiceUrl } from '@/lib/auth/cookies';

/**
 * POST /api/auth/reset-password
 *
 * Forwards a reset-token + new password pair to the upstream auth-service.
 * On success the user is redirected to /login by the client.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { token?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body.' }, { status: 400 });
  }

  const { token, newPassword } = body;
  if (!token || !newPassword) {
    return NextResponse.json(
      { message: 'Reset token and new password are required.' },
      { status: 400 },
    );
  }

  const tenantId = request.headers.get('x-tenant-id') ?? 'default';

  let upstream: Response;
  try {
    upstream = await fetch(`${getAuthServiceUrl()}/auth/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId,
      },
      body: JSON.stringify({ token, newPassword }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { message: 'Authentication service is unavailable.' },
      { status: 503 },
    );
  }

  if (!upstream.ok) {
    const data = (await safeJson(upstream)) as { message?: string };
    return NextResponse.json(
      {
        message:
          data.message || 'The reset link is invalid or has expired. Please request a new one.',
      },
      { status: upstream.status },
    );
  }

  return NextResponse.json({ success: true });
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
