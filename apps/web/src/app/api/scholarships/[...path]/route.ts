/**
 * Same-origin scholarship proxy.
 *
 * Client components cannot read the httpOnly access token, and the gateway
 * does not accept that cookie. This route attaches the session bearer and
 * forwards only under /api/v1/scholarships.
 */
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from '@/lib/api/gateway';

const SAFE_PATH = /^[a-z0-9][a-z0-9/_-]{0,240}$/i;

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const joined = path.join('/');
  if (!SAFE_PATH.test(joined) || joined.includes('..')) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Invalid scholarship path' },
      { status: 400 },
    );
  }

  const { tenantId, accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json(
      { code: 'UNAUTHENTICATED', message: 'Sign in required' },
      { status: 401 },
    );
  }

  const upstreamUrl = new URL(
    `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/scholarships/${joined}`,
  );
  upstreamUrl.search = new URL(request.url).search;

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('X-Tenant-ID', tenantId);
  headers.set('Accept', request.headers.get('accept') ?? 'application/json');
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  const method = request.method.toUpperCase();
  const init: RequestInit = { method, headers, cache: 'no-store' };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Buffer.from(await request.arrayBuffer());
  }

  const upstream = await fetch(upstreamUrl, init);
  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'private, no-store',
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
