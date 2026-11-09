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

import { AUTH_COOKIES, isTokenExpired, type TokenPayload } from './session';
import { readSessionToken, tenantIdFromClaims } from './verified-token';

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
 * PRC-L254: the access token's signature, issuer and audience are verified
 * against the IdP JWKS (see `./verified-token.ts`); a forged or unsigned token
 * yields no session. The API gateway still verifies the JWT on every forwarded
 * call, ignores client X-Tenant-ID and requires a verified tenant claim.
 */
export async function getSession(): Promise<ServerSession | null> {
  const jar = await cookies();
  const accessToken = jar.get(AUTH_COOKIES.ACCESS_TOKEN)?.value;
  const refreshToken = jar.get(AUTH_COOKIES.REFRESH_TOKEN)?.value ?? null;

  if (!accessToken) {
    return null;
  }

  const claims = await readSessionToken(accessToken, { ignoreExpiry: true });
  if (!claims) {
    return null;
  }
  const payload = claims as unknown as TokenPayload;
  // Keycloak tokens carry `tenant_id`; expose it under the BFF's `tenantId`.
  const tenantId = tenantIdFromClaims(claims);

  return {
    accessToken,
    refreshToken,
    user: tenantId ? { ...payload, tenantId } : payload,
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
    const params = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
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
