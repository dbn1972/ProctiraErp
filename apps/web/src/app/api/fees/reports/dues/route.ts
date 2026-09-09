/**
 * Authenticated proxy for GET /fees/reports/dues?format=csv (G-903).
 */
import { NextResponse } from 'next/server';

import { GATEWAY_API_PREFIX, GATEWAY_BASE_URL, getSessionContext } from '@/lib/api/gateway';

export async function GET(): Promise<Response> {
  const { tenantId, accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }

  const upstream = await fetch(
    `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/fees/reports/dues?format=csv`,
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
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition':
        upstream.headers.get('content-disposition') ??
        'attachment; filename="fees-dues-report.csv"',
      'cache-control': 'private, no-store',
    },
  });
}
