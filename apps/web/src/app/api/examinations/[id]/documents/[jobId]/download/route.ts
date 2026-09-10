/**
 * G-902 — authenticated proxy for examination document downloads.
 *
 * The gateway route needs the bearer token, which a plain `<a href>` cannot
 * carry, so the Documents tab links here and this handler streams the PDF
 * from `GET /examinations/:id/documents/jobs/:jobId/download`.
 */
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from '@/lib/api/gateway';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; jobId: string }> },
): Promise<Response> {
  const { id, jobId } = await context.params;
  if (!UUID.test(id) || !UUID.test(jobId)) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'Invalid id' }, { status: 400 });
  }

  const { tenantId, accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }

  const upstream = await fetch(
    `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/examinations/${id}/documents/jobs/${jobId}/download`,
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

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition':
        upstream.headers.get('content-disposition') ?? `attachment; filename="${jobId}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}
