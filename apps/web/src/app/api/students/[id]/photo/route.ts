/**
 * G-914 — authenticated proxy for student profile photos.
 *
 * NEW-g1a_web-002: upstream fetch bounded by timeout + size cap via
 * `fetchFromGateway`; body is streamed (not buffered).
 */
import { NextResponse } from 'next/server';

import { fetchFromGateway, ProxyError } from '@/lib/api/proxy-download';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'Invalid id' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetchFromGateway(`/students/${id}/photo`);
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

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  if (contentType.includes('application/json')) {
    const payload = (await upstream.json()) as { url?: string };
    if (payload.url) {
      return NextResponse.redirect(payload.url);
    }
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'private, no-store',
    },
  });
}
