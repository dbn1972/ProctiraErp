import { NextResponse } from 'next/server';

import { assertInstallSecurity } from '@/lib/install-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin account step on the local BFF — validates CSRF/token and rejects when locked.
 * Live IdP provisioning remains a residual when upstream install API is used.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const security = assertInstallSecurity(request);
  if (!security.ok) {
    return NextResponse.json(
      { success: false, error: security.error },
      { status: security.status },
    );
  }

  if (security.session.locked) {
    return NextResponse.json(
      { success: false, error: 'Bootstrap already finalized; install endpoints are locked.' },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const data = body as {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    tenantName?: string;
    tenantSlug?: string;
  };

  if (!data.email || !data.password || !data.tenantSlug) {
    return NextResponse.json(
      { success: false, error: 'email, password, and tenantSlug are required.' },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true });
}
