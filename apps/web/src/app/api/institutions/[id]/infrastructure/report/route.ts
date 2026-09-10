/**
 * G-925 — facility verification report (CSV) for one institution.
 *
 * Flattens the Land → Building → Floor → Room hierarchy served by
 * `/infrastructure/hierarchy/:institutionId` into one row per asset so
 * inspectors can verify capacity and condition offline.
 */
import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/api/gateway';
import { ApiClientError, getInfrastructureHierarchy } from '@/lib/institutions/api';
import { hierarchyToCsv } from '@/lib/institutions/infrastructure-csv';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Invalid institution id' },
      { status: 400 },
    );
  }
  const { accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }

  try {
    const hierarchy = await getInfrastructureHierarchy(id);
    return new NextResponse(hierarchyToCsv(hierarchy), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="facility-verification-${id}.csv"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    const status = error instanceof ApiClientError && error.statusCode ? error.statusCode : 502;
    return NextResponse.json(
      {
        code: 'UPSTREAM_ERROR',
        message: error instanceof Error ? error.message : 'Report generation failed',
      },
      { status: status >= 400 && status < 600 ? status : 502 },
    );
  }
}
