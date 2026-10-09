/**
 * Authenticated proxy for GET /fees/reports/dues?format=csv (G-903).
 *
 * NEW-g1a_web-002: the upstream fetch is bounded by a timeout + size cap via
 * `fetchFromGateway`, so a hung or oversized report cannot exhaust the server.
 */
import { NextResponse } from 'next/server';

import { fetchFromGateway, ProxyError } from '@/lib/api/proxy-download';
import {
  labelDuesCsv,
  loadFeeClassLabels,
} from '@/app/(dashboard)/fees/_components/load-fee-class-labels';

export async function GET(): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetchFromGateway('/fees/reports/dues?format=csv');
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

  const csv = await upstream.text();
  const labels = await loadFeeClassLabels();
  return new NextResponse(labelDuesCsv(csv, labels), {
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
