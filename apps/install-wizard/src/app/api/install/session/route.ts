import { NextResponse } from 'next/server';

import { createInstallSession, getBootstrapStatus } from '@/lib/bootstrap-lock';
import { CSRF_COOKIE, INSTALL_TOKEN_COOKIE } from '@/lib/install-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Issue a per-browser install session: CSRF cookie + install token.
 * Client must echo both on mutating configure/finalize calls.
 */
export async function GET(): Promise<NextResponse> {
  const session = createInstallSession();
  const body = {
    csrfToken: session.csrfToken,
    installToken: session.installToken,
    status: getBootstrapStatus(session),
  };

  const response = NextResponse.json(body);
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false, // double-submit: JS may also set header from JSON
    sameSite: 'strict',
    path: '/',
    secure,
  });
  response.cookies.set(INSTALL_TOKEN_COOKIE, session.installToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure,
  });
  return response;
}
