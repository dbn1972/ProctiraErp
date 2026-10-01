import { NextResponse, type NextRequest } from 'next/server';
import { getAuthServiceUrl } from '@/lib/auth/cookies';
import { AUTH_COOKIES } from '@/lib/auth/session';
import { resolveTenantForRequest } from '@/lib/api/request-tenant';

/**
 * POST /api/auth/mfa/setup
 *
 * PRC-H019 — proxies TOTP enrolment to the auth service using the caller's
 * httpOnly session cookie. The secret and backup codes are issued (and
 * persisted) upstream; this handler never generates them. No session → 401,
 * upstream unavailable → 503, upstream error status is passed through so the
 * client renders an error state instead of a QR code.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const accessToken = request.cookies.get(AUTH_COOKIES.ACCESS_TOKEN)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: 'Authentication required.' }, { status: 401 });
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
  // PRC-H027: tenant comes from the Host, never from a client header.
  const tenantId = resolveTenantForRequest(request);
  if (tenantId) headers['X-Tenant-ID'] = tenantId;

  let upstream: Response;
  try {
    upstream = await fetch(`${getAuthServiceUrl()}/auth/mfa/setup`, {
      method: 'POST',
      headers,
      body: '{}',
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { message: 'Authentication service is unavailable.' },
      { status: 503 },
    );
  }

  const text = await upstream.text().catch(() => '');
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return NextResponse.json(data, {
    status: upstream.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
