/**
 * G-915 — authenticated proxy for LMS submission files.
 * Obtains an HMAC download token then streams the object.
 */
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from '@/lib/api/gateway';

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
    const signed = await fetch(
      `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/lms/files/${id}/signed-download`,
      { method: 'POST', headers: auth, cache: 'no-store' },
    );
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

  const upstream = await fetch(
    `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/lms/files/${id}/download?token=${encodeURIComponent(token)}`,
    { headers: auth, cache: 'no-store' },
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
