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
    return redirectToLogin(request, { error: 'missing_ticket', returnTo });
  }

  let upstream: Response;
  try {
    const ticketUrl = new URL('/api/v1/auth/ticket', getGatewayUrl());
    ticketUrl.searchParams.set('ticket', ticket);
    upstream = await fetch(ticketUrl, { cache: 'no-store' });
  } catch {
    return redirectToLogin(request, { error: 'auth_unavailable', returnTo });
  }

  const data = (await safeJson(upstream)) as {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  };

  if (!upstream.ok || !data.accessToken) {
    return redirectToLogin(request, { error: 'ticket_invalid', returnTo });
  }

  const response = NextResponse.redirect(new URL(returnTo, request.url));
  response.cookies.set(
    AUTH_COOKIES.ACCESS_TOKEN,
    data.accessToken,
    accessTokenCookieOptions(data.expiresIn ?? 900),
  );
  if (data.refreshToken) {
    response.cookies.set(
      AUTH_COOKIES.REFRESH_TOKEN,
      data.refreshToken,
      refreshTokenCookieOptions(),
    );
  }
  return response;
}

function redirectToLogin(
  request: Request,
  params: { error?: string; returnTo?: string },
): NextResponse {
  const loginUrl = new URL('/login', request.url);
  if (params.error) loginUrl.searchParams.set('error', params.error);
  if (params.returnTo) loginUrl.searchParams.set('returnTo', sanitizeReturnTo(params.returnTo));
  return NextResponse.redirect(loginUrl);
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const text = await response.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
