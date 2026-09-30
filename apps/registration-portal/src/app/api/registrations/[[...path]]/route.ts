/**
 * Same-origin proxy for browser calls to the public registration API.
 *
 * Browser code calls `/api/registrations/*` on the portal; this handler
 * forwards to `<GATEWAY_URL>/api/v1/registrations/*` at runtime.
 */
import type { NextRequest } from 'next/server';

import { gatewayRequest } from '@/lib/gateway';
import { buildRegistrationProxyPath } from '@/lib/gateway-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FORWARDED_REQUEST_HEADERS = ['content-type', 'idempotency-key', 'accept-language', 'cookie'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'set-cookie', 'retry-after'];

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const upstreamPath = buildRegistrationProxyPath(path, request.nextUrl.search);
  if (!upstreamPath) {
    return Response.json(
      { code: 'NOT_FOUND', message: 'Not found', statusCode: 404 },
      { status: 404 },
    );
  }
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  try {
    const upstream = await gatewayRequest(upstreamPath, {
      method: request.method,
      headers,
      body,
    });
    const responseHeaders = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      for (const value of name === 'set-cookie'
        ? upstream.headers.getSetCookie()
        : [upstream.headers.get(name)]) {
        if (value) responseHeaders.append(name, value);
      }
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json(
      {
        code: 'REGISTRATION_GATEWAY_UNAVAILABLE',
        message: 'Registration service is temporarily unavailable',
        statusCode: 502,
      },
      { status: 502 },
    );
  }
}

export { proxy as GET, proxy as POST };
