import { NextResponse } from 'next/server';

import {
  accessTokenCookieOptions,
  getGatewayUrl,
  refreshTokenCookieOptions,
} from '@/lib/auth/cookies';
import { sanitizeReturnTo } from '@/lib/auth/return-to';
import { AUTH_COOKIES } from '@/lib/auth/session';

/**
 * GET /api/auth/callback?ticket=...&returnTo=...
 *
 * Redeems a one-time Keycloak login ticket from the API gateway and stores
 * access + refresh tokens as httpOnly cookies.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const incoming = new URL(request.url);
  const ticket = incoming.searchParams.get('ticket');
  const returnTo = sanitizeReturnTo(incoming.searchParams.get('returnTo') || '/');

  if (!ticket) {
    return redirectToLogin({ error: 'missing_ticket', returnTo });
  }

  let upstream: Response;
  try {
    const ticketUrl = new URL('/api/v1/auth/ticket', getGatewayUrl());
    ticketUrl.searchParams.set('ticket', ticket);
    upstream = await fetch(ticketUrl, { cache: 'no-store' });
  } catch {
    return redirectToLogin({ error: 'auth_unavailable', returnTo });
  }

  const data = (await safeJson(upstream)) as {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  };

  if (!upstream.ok || !data.accessToken) {
    return redirectToLogin({ error: 'ticket_invalid', returnTo });
  }

  const response = relativeRedirect(returnTo);
  response.cookies.set(
    AUTH_COOKIES.ACCESS_TOKEN,
    data.accessToken,
    accessTokenCookieOptions(data.expiresIn ?? 900, request),
  );
  if (data.refreshToken) {
    response.cookies.set(
      AUTH_COOKIES.REFRESH_TOKEN,
      data.refreshToken,
      refreshTokenCookieOptions(undefined, request),
    );
  }
  return response;
}

function redirectToLogin(params: { error?: string; returnTo?: string }): NextResponse {
  const query = new URLSearchParams();
  if (params.error) query.set('error', params.error);
  if (params.returnTo) query.set('returnTo', sanitizeReturnTo(params.returnTo));
  const search = query.toString();
  return relativeRedirect(search ? `/login?${search}` : '/login');
}

/**
 * UATENV-D05: behind a proxy the standalone server's `request.url` is its bind
 * address (`http://0.0.0.0:3001`), so an absolute redirect built from it sent
 * the browser to 0.0.0.0. A relative Location (RFC 9110 §10.2.2) resolves
 * against the public URL the browser is on. `path` is already a sanitised
 * same-origin path; re-resolving it against a sentinel origin keeps only its
 * path, query and fragment. Dot segments the sanitiser accepts (`/.//evil.com`)
 * resolve to a pathname starting with `//`, which as a Location is
 * protocol-relative and leaves the site, so leading slashes collapse to one.
 */
function relativeRedirect(path: string): NextResponse {
  const target = new URL(path, 'http://sentinel.invalid');
  const pathname = target.pathname.replace(/^\/+/, '/');
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `${pathname}${target.search}${target.hash}` },
  });
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
