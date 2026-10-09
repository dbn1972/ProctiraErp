/**
 * G-915 — authenticated proxy for LMS submission files.
 * Obtains an HMAC download token then streams the object.
 *
 * NEW-g1a_web-002: both the token POST and the download GET are bounded by a
 * timeout; the download body is streamed via `fetchFromGateway` with a size cap.
 */
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from '@/lib/api/gateway';
import { fetchFromGateway, ProxyError, PROXY_TIMEOUT_MS } from '@/lib/api/proxy-download';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'Invalid id' }, { status: 400 });
  }

  const { tenantId, accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }

  const auth = { Authorization: `Bearer ${accessToken}`, 'X-Tenant-ID': tenantId };
  const queryToken = new URL(request.url).searchParams.get('token') ?? '';
  let token = tokenFrom(queryToken);
  if (!token) {
    let signed: Response;
    try {
      signed = await fetch(
        `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/lms/files/${id}/signed-download`,
        {
          method: 'POST',
          headers: auth,
          cache: 'no-store',
          signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        },
      );
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      return NextResponse.json(
        {
          code: isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNREACHABLE',
          message: isTimeout
            ? 'The upstream service did not respond in time.'
            : 'The upstream service is unavailable.',
        },
        { status: isTimeout ? 504 : 502 },
      );
    }
    if (!signed.ok) {
      const body = await signed.text();
      return new NextResponse(body, {
        status: signed.status,
        headers: { 'content-type': signed.headers.get('content-type') ?? 'application/json' },
      });
    }
    const payload = (await signed.json()) as { token?: string };
    token = payload.token ?? '';
  }

  let upstream: Response;
  try {
    upstream = await fetchFromGateway(
      `/lms/files/${id}/download?token=${encodeURIComponent(token)}`,
    );
  } catch (err) {
    if (err instanceof ProxyError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    throw err;
  }

  if (!upstream.ok) {
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        upstream.headers.get('content-disposition') ?? `attachment; filename="lms-file-${id}"`,
      'cache-control': 'private, no-store',
    },
  });
}

function tokenFrom(value: string): string {
  return value.trim();
}
