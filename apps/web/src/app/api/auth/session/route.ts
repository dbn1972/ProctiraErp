import { NextResponse } from 'next/server';

import { authUserFromTokenPayload } from '@/lib/auth/auth-user';
import { getSession } from '@/lib/auth/server';

/**
 * GET /api/auth/session
 *
 * Returns the current AuthUser derived from the httpOnly access_token cookie
 * (same gate middleware / `getSession()` use). Does **not** expose the raw
 * JWT to the browser — only claims needed for client UX (dashboard routing,
 * header display).
 *
 * Expired tokens return `{ authenticated: false, reason: 'expired' }` so the
 * client AuthProvider can call `POST /api/auth/refresh` and retry.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
  }

  if (session.isExpired) {
    return NextResponse.json(
      { authenticated: false, user: null, reason: 'expired' },
      { status: 200 },
    );
  }

  const user = authUserFromTokenPayload(session.user);
  return NextResponse.json({
    authenticated: true,
    user,
  });
}
