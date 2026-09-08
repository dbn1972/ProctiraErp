/**
 * CSRF + install-token helpers for Install Wizard BFF routes.
 */

import { cookies } from 'next/headers';

import { getInstallSession, type InstallSession } from './bootstrap-lock';

export const CSRF_COOKIE = 'install_csrf';
export const INSTALL_TOKEN_COOKIE = 'install_token';
export const CSRF_HEADER = 'x-csrf-token';
export const INSTALL_TOKEN_HEADER = 'x-install-token';

export function readHeader(request: Request, name: string): string | null {
  return request.headers.get(name);
}

/**
 * Validate double-submit CSRF + install-token against cookies / session store.
 */
export function assertInstallSecurity(request: Request):
  | {
      ok: true;
      session: InstallSession;
    }
  | {
      ok: false;
      status: number;
      error: string;
    } {
  const cookieStore = cookies();
  const csrfCookie = cookieStore.get(CSRF_COOKIE)?.value;
  const tokenCookie = cookieStore.get(INSTALL_TOKEN_COOKIE)?.value;
  const csrfHeader = readHeader(request, CSRF_HEADER);
  const tokenHeader = readHeader(request, INSTALL_TOKEN_HEADER);

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return { ok: false, status: 403, error: 'Missing or invalid CSRF token.' };
  }

  // Require explicit header (cookie alone is not enough — pairs with CSRF double-submit).
  if (!tokenHeader) {
    return { ok: false, status: 401, error: 'Missing or invalid install token.' };
  }
  if (tokenCookie && tokenCookie !== tokenHeader) {
    return { ok: false, status: 401, error: 'Missing or invalid install token.' };
  }

  const session = getInstallSession(tokenHeader);
  if (!session) {
    return { ok: false, status: 401, error: 'Install session not found or expired.' };
  }

  if (session.csrfToken !== csrfHeader) {
    return { ok: false, status: 403, error: 'Missing or invalid CSRF token.' };
  }

  return { ok: true, session };
}
