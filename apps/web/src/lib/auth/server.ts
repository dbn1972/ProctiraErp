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
import { cache } from 'react';

import { getGatewayUrl } from './cookies';
import { AUTH_COOKIES, isTokenExpired, type TokenPayload } from './session';
import { normaliseTokenClaims } from './token-claims';
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
  // UATENV-D06: platform and Keycloak claims normalised to one shape. PRC-L213:
  // the tenant comes only from a single-valued `tenantId`/`tenant_id` claim.
  const payload: TokenPayload = {
    ...normaliseTokenClaims(claims),
    tenantId: tenantIdFromClaims(claims) ?? '',
  };

  const isExpired = isTokenExpired(accessToken);
  const principal =
    payload.idp === 'keycloak' && !isExpired ? await resolveGatewayPrincipal(accessToken) : null;

  return {
    accessToken,
    refreshToken,
    user: principal
      ? { ...payload, sub: principal.sub, tenantId: principal.tenantId || payload.tenantId }
      : payload,
    isExpired,
  };
}

/**
 * UATENV-D06: the gateway links a Keycloak subject to a local user and uses
 * that local id as `sub` (packages/backend/auth/src/keycloak/plugin.ts), so
 * per-user routes such as `/notifications/user/:id` need the local id, not the
 * Keycloak `sub` in the token. Asks the gateway once per request (React
 * `cache`) for the principal; on any failure the token claims are kept.
 */
const resolveGatewayPrincipal = cache(
  async (accessToken: string): Promise<{ sub: string; tenantId: string } | null> => {
    try {
      const response = await fetch(new URL('/api/v1/auth/me', getGatewayUrl()), {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { user?: { sub?: unknown; tenantId?: unknown } };
      const sub = body.user?.sub;
      if (typeof sub !== 'string' || !sub) return null;
      const tenantId = body.user?.tenantId;
      return { sub, tenantId: typeof tenantId === 'string' ? tenantId : '' };
    } catch {
      return null;
    }
  },
);

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
