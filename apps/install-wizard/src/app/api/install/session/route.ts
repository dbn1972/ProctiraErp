import { NextResponse } from 'next/server';

import { createInstallSession, getBootstrapStatus } from '@/lib/bootstrap-lock';
import {
  BOOTSTRAP_SECRET_HEADER,
  checkBootstrapSecret,
  installLockState,
} from '@/lib/install-lock-store';
import { CSRF_COOKIE, INSTALL_TOKEN_COOKIE } from '@/lib/install-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Issue a per-browser install session: CSRF cookie + install token.
 * Client must echo both on mutating configure/finalize calls.
 *
 * PRC-M467: only an operator holding the bootstrap secret (`INSTALL_BOOTSTRAP_SECRET`, from the
 * secret manager, sent in `x-install-bootstrap-secret`) can open a session, and no session is
 * issued once the global install lock is engaged. Fails closed (503) when either the secret or
 * the lock storage is not configured.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = checkBootstrapSecret(request.headers.get(BOOTSTRAP_SECRET_HEADER));
  if (secret === 'unconfigured') {
    return NextResponse.json(
      { success: false, error: 'Installer bootstrap secret is not configured.' },
      { status: 503 },
    );
  }
  if (secret !== 'ok') {
    return NextResponse.json(
      { success: false, error: 'Missing or invalid bootstrap secret.' },
      { status: 401 },
    );
  }
  const lock = installLockState();
  if (lock === 'unconfigured') {
    return NextResponse.json(
      { success: false, error: 'Install lock storage is not configured.' },
      { status: 503 },
    );
  }
  if (lock === 'locked') {
    return NextResponse.json(
      { success: false, error: 'Bootstrap already finalized; install endpoints are locked.' },
      { status: 409 },
    );
  }

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
