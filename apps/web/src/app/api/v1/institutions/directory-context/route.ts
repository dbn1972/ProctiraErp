/**
 * Same-origin proxy for GET /api/v1/institutions/directory-context.
 * The browser session cookie is on this origin; the gateway call uses the
 * bearer token and the token's own tenant claim.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL } from '@/lib/api/gateway';
import { AUTH_COOKIES } from '@/lib/auth';

export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(AUTH_COOKIES.ACCESS_TOKEN)?.value ?? null;
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });
  }

  try {
    const upstream = await fetch(
      `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/institutions/directory-context`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      },
    );
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { code: 'UPSTREAM_UNAVAILABLE', message: 'Institution directory is unavailable' },
      { status: 503 },
    );
  }
}
