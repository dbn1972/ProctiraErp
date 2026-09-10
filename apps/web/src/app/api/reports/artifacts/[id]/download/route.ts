/**
 * G-909 — authenticated proxy for catalogue artifact downloads.
 * Forwards session cookies to the gateway and surfaces X-Artifact-Sha256.
 */
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from '@/lib/api/gateway';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
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

  const upstream = await fetch(
    `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/reports/artifacts/${id}/download`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Tenant-ID': tenantId },
      cache: 'no-store',
    },
  );

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
