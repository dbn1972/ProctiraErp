/**
 * Same-origin proxy for the cross-board transfer workflow.
 * The session cookie is httpOnly on this origin. The gateway expects a bearer
 * token, so this route attaches it and forwards the path, query, and body.
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL } from '@/lib/api/gateway';
import { AUTH_COOKIES } from '@/lib/auth';

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(AUTH_COOKIES.ACCESS_TOKEN)?.value ?? null;
  if (!accessToken) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required' },
      { status: 401 },
    );
  }

  const { path = [] } = await context.params;
  const suffix = path.length > 0 ? `/${path.map(encodeURIComponent).join('/')}` : '';
  const target = `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/transfers${suffix}${request.nextUrl.search}`;
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Accept', 'application/json');
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  const method = request.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text();

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: 'no-store',
    });
    const payload = await upstream.text();
    return new NextResponse(payload, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { code: 'UPSTREAM_UNAVAILABLE', message: 'Transfer workflow is unavailable' },
      { status: 503 },
    );
  }
}

export function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxy(request, context);
}

export function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxy(request, context);
}

export function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxy(request, context);
}

export function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxy(request, context);
}
