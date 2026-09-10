/**
 * G-913 — authenticated proxy for DSAR package downloads.
 *
 * `GET /audit-logs/dsar/:subjectId` needs the bearer token, which a plain
 * `<a download>` cannot carry, so the DSAR page links here and this handler
 * relays the JSON with an attachment disposition.
 */
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from '@/lib/api/gateway';

const SUBJECT = /^[A-Za-z0-9._@-]{1,200}$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ subjectId: string }> },
): Promise<Response> {
  const { subjectId } = await context.params;
  if (!SUBJECT.test(subjectId)) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Invalid subject id' },
      { status: 400 },
    );
  }

  const { tenantId, accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }

  const upstream = await fetch(
    `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/audit-logs/dsar/${encodeURIComponent(subjectId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Tenant-ID': tenantId },
      cache: 'no-store',
    },
  );

  const body = await upstream.text();
  if (!upstream.ok) {
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="dsar-${subjectId}.json"`,
      'cache-control': 'private, no-store',
    },
  });
}
