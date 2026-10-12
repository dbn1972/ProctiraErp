/**
 * G-909 — authenticated proxy for catalogue artifact downloads.
 * Forwards the session to the gateway and surfaces X-Artifact-Sha256.
 *
 * NEW-g1a_web-002: upstream fetch bounded by timeout + size cap via
 * `fetchFromGateway`; body is streamed (not buffered).
 */
import { NextResponse } from 'next/server';

import { fetchFromGateway, ProxyError } from '@/lib/api/proxy-download';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    upstream = await fetchFromGateway(`/reports/artifacts/${id}/download`);
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

  const sha = upstream.headers.get('x-artifact-sha256');
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        upstream.headers.get('content-disposition') ?? `attachment; filename="report-${id}"`,
      'cache-control': 'private, no-store',
      ...(sha ? { 'x-artifact-sha256': sha } : {}),
    },
  });
}
