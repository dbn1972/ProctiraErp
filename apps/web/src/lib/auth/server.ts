/**
 * Server-side authentication utilities.
 *
 * These helpers run inside Next.js Route Handlers, Server Components,
 * and Server Actions. They read tokens from httpOnly cookies (set by
 * /api/auth/* route handlers) and forward authenticated requests to the
 * upstream auth-service.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  AUTH_COOKIES,
  decodeTokenPayload,
  isTokenExpired,
  type TokenPayload,
} from './session';

/** Result returned by getSession. */
export interface ServerSession {
  accessToken: string;
  refreshToken: string | null;
  user: TokenPayload;
  isExpired: boolean;
}

/**
 * Reads authentication cookies on the server and returns the parsed session
 * if available. Returns `null` when there is no token or the token is malformed.
 *
 * The access token is decoded for routing/permissions decisions only. The
 * cryptographic signature is validated by the upstream auth-service whenever
 * the token is forwarded on an API call.
 */
export async function getSession(): Promise<ServerSession | null> {
  const jar = await cookies();
  const accessToken = jar.get(AUTH_COOKIES.ACCESS_TOKEN)?.value;
  const refreshToken = jar.get(AUTH_COOKIES.REFRESH_TOKEN)?.value ?? null;

  if (!accessToken) {
    return null;
  }

  const payload = decodeTokenPayload(accessToken);
  if (!payload) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    user: payload,
    isExpired: isTokenExpired(accessToken),
  };
}

/**
 * Server-component helper that enforces authentication. Redirects to /login
 * (preserving the requested path as `returnTo`) when no valid session exists.
 *
 * Usage:
 *   const session = await requireSession('/students');
 *   <p>Hello {session.user.email}</p>
 */
export async function requireSession(returnTo?: string): Promise<ServerSession> {
  const session = await getSession();
  if (!session || session.isExpired) {
    const params = returnTo
      ? `?returnTo=${encodeURIComponent(returnTo)}`
      : '';
    redirect(`/login${params}`);
  }
  return session;
}

/**
 * Wrapper for server-side `fetch` calls that automatically attach the access
 * token from cookies. Use this from server components or route handlers when
 * calling protected upstream APIs.
 */
export async function authenticatedFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const session = await getSession();
  const headers = new Headers(init.headers);
  if (session) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
    if (session.user.tenantId) {
      headers.set('X-Tenant-ID', session.user.tenantId);
    }
  }
  return fetch(input, { ...init, headers });
}
