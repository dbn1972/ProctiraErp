/**
 * PRC-L039 — authenticated proxy for board export pack downloads.
 *
 * A plain `<a href>` cannot carry the bearer token, so the board exports page
 * links here. The handler mints a short-lived tenant-bound token via
 * `POST /gradebook/board-exports/:id/signed-download`, then streams
 * `GET /gradebook/board-exports/:id/download?token=…`. The gateway scopes both
 * calls to the caller's tenant (another tenant's job id → 404) and records the
 * `board_export.download` audit event.
 */
import { NextResponse } from 'next/server';

import {
  GATEWAY_API_PREFIX,
  GATEWAY_BASE_URL,
  getSessionContext,
  tenantHeader,
} from '@/lib/api/gateway';
import { canAccessExaminationRoutes } from '@/lib/auth/examination-route-guards';
import { getSession } from '@/lib/auth/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMATS = new Set(['pack', 'csv', 'json', 'html']);

function passThrough(upstream: Response, body: string): NextResponse {
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  const format = new URL(request.url).searchParams.get('format') ?? 'pack';
  if (!UUID.test(jobId) || !FORMATS.has(format)) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Invalid request' },
      { status: 400 },
    );
  }
  const session = await getSession();
  if (!session || session.isExpired) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }
  if (!canAccessExaminationRoutes(session)) {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      { status: 403 },
    );
  }
  const { tenantId, accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }
  const headers = { Authorization: `Bearer ${accessToken}`, ...tenantHeader(tenantId) };
  const base = `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/gradebook/board-exports/${encodeURIComponent(jobId)}`;

  const signed = await fetch(`${base}/signed-download`, {
    method: 'POST',
    headers,
    cache: 'no-store',
  });
  if (!signed.ok) return passThrough(signed, await signed.text());
  const { token } = (await signed.json()) as { token?: unknown };
  if (typeof token !== 'string' || token.length === 0) {
    return NextResponse.json(
      { code: 'DOWNLOAD_UNAVAILABLE', message: 'Download token unavailable' },
      { status: 502 },
    );
  }

  const upstream = await fetch(
    `${base}/download?format=${encodeURIComponent(format)}&token=${encodeURIComponent(token)}`,
    { headers, cache: 'no-store' },
  );
  if (!upstream.ok) return passThrough(upstream, await upstream.text());
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        upstream.headers.get('content-disposition') ?? `attachment; filename="board-pack-${jobId}"`,
      'cache-control': 'private, no-store',
    },
  });
}
