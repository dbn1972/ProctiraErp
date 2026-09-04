import { NextResponse } from 'next/server';

import {
  accessTokenCookieOptions,
  getGatewayUrl,
  refreshTokenCookieOptions,
} from '@/lib/auth/cookies';
import { AUTH_COOKIES } from '@/lib/auth/session';

/**
 * GET /api/auth/callback
 *
 * Redeems the one-time Keycloak ticket issued by the gateway and stores
 * access + refresh tokens in httpOnly cookies.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const incoming = new URL(request.url);
  const ticket = incoming.searchParams.get('ticket');
  const returnTo = incoming.searchParams.get('returnTo') || '/';
  const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/';

  if (!ticket) {
    const failed = new URL('/login', incoming.origin);
    failed.searchParams.set('error', 'oauth');
    return NextResponse.redirect(failed);
  }

  let upstream: Response;
  try {
    const ticketUrl = new URL('/api/v1/auth/ticket', getGatewayUrl());
    ticketUrl.searchParams.set('ticket', ticket);
    upstream = await fetch(ticketUrl, { cache: 'no-store' });
  } catch {
    const failed = new URL('/login', incoming.origin);
    failed.searchParams.set('error', 'oauth');
    return NextResponse.redirect(failed);
  }

  const data = (await upstream.json().catch(() => ({}))) as {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  };

  if (!upstream.ok || !data.accessToken) {
    const failed = new URL('/login', incoming.origin);
    failed.searchParams.set('error', 'oauth');
    return NextResponse.redirect(failed);
  }

  const redirect = NextResponse.redirect(new URL(safeReturnTo, incoming.origin));
  redirect.cookies.set(
    AUTH_COOKIES.ACCESS_TOKEN,
    data.accessToken,
    accessTokenCookieOptions(data.expiresIn ?? 300),
  );
  if (data.refreshToken) {
    redirect.cookies.set(
      AUTH_COOKIES.REFRESH_TOKEN,
      data.refreshToken,
      refreshTokenCookieOptions(),
    );
  }
  return redirect;
}
