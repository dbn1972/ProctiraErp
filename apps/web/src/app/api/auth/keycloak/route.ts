import { NextResponse } from 'next/server';

import { getGatewayUrl } from '@/lib/auth/cookies';

/**
 * GET /api/auth/keycloak
 *
 * Starts the Keycloak authorization-code flow via the API gateway.
 * The gateway callback later redirects back to /api/auth/callback.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const incoming = new URL(request.url);
  const returnTo = incoming.searchParams.get('returnTo') || '/';
  const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/';
  const gateway = new URL('/api/v1/auth/login', getGatewayUrl());
  gateway.searchParams.set('state', `web:${safeReturnTo}`);
  return NextResponse.redirect(gateway);
}
