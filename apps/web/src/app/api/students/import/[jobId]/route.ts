/**
 * PRC-H092/H093 — authenticated proxy for async student-import progress.
 *
 * `BulkImportPanel` polls `/api/students/import/:jobId` from the browser, which
 * cannot carry the bearer token. This handler forwards to the gateway's
 * `GET /students/import/:jobId` with the session token and tenant header.
 *
 * The gateway body is already the panel's `ImportProgress` shape
 * (`jobId`, `status`, `result?`, `errorMessage?`, …) with no envelope, so the
 * 200 body is passed through. Upstream error bodies are replaced with a fixed
 * `{ code, message }` so gateway messages are not surfaced to the browser.
 */
import { NextResponse } from 'next/server';
import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from '@/lib/api/gateway';
import { getSession } from '@/lib/auth/server';

/** Same pattern the gateway route validates (lowercase UUID v4 from `uuidv4()`). */
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const NO_STORE = { 'cache-control': 'private, no-store' } as const;

const PASS_THROUGH_ERRORS: Record<number, { code: string; message: string }> = {
  400: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
  401: { code: 'UNAUTHENTICATED', message: 'Sign in' },
  403: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
  404: { code: 'NOT_FOUND', message: 'Import job not found' },
};

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params;
  if (!JOB_ID.test(jobId)) {
    return json({ code: 'VALIDATION_ERROR', message: 'Invalid job id' }, 400);
  }
  const session = await getSession();
  if (!session || session.isExpired) {
    return json(PASS_THROUGH_ERRORS[401], 401);
  }
  const { tenantId, accessToken } = await getSessionContext();
  if (!accessToken) {
    return json(PASS_THROUGH_ERRORS[401], 401);
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/students/import/${encodeURIComponent(jobId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Tenant-ID': tenantId,
          Accept: 'application/json',
        },
        cache: 'no-store',
      },
    );
  } catch {
    return json({ code: 'UPSTREAM_UNAVAILABLE', message: 'Import status unavailable' }, 502);
  }

  if (!upstream.ok) {
    const mapped = PASS_THROUGH_ERRORS[upstream.status];
    return mapped
      ? json(mapped, upstream.status)
      : json({ code: 'UPSTREAM_ERROR', message: 'Import status unavailable' }, 502);
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    payload = null;
  }
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as { status?: unknown }).status !== 'string' ||
    typeof (payload as { jobId?: unknown }).jobId !== 'string'
  ) {
    return json({ code: 'UPSTREAM_ERROR', message: 'Import status unavailable' }, 502);
  }
  return json(payload, 200);
}
