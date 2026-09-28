/**
 * Same-origin label lookup for breadcrumb UUID segments.
 *
 * The access token is an httpOnly cookie on this origin. A browser call
 * straight to the gateway cannot attach it (cross-origin), so the crumb
 * stayed on the shortened id. This route forwards the cookie as a bearer
 * token and returns only the display name.
 */
import { NextResponse } from 'next/server';

import { gatewayFetch } from '@/lib/api/gateway';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readName(data: { name?: string; code?: string } | null): string | null {
  const name = data?.name?.trim();
  if (name) return name;
  const code = data?.code?.trim();
  return code || null;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const institutionId = url.searchParams.get('institutionId');
  const sectionId = url.searchParams.get('sectionId');
  const transferId = url.searchParams.get('transferId');

  if (institutionId && UUID.test(institutionId)) {
    const result = await gatewayFetch<{ name?: string; code?: string }>(
      `/institutions/${encodeURIComponent(institutionId)}`,
      { throwOnError: false, cache: 'no-store' },
    );
    const name = readName(result.data);
    if (result.ok && name) {
      return NextResponse.json({ name }, { headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.json({ name: null }, { status: result.status || 404 });
  }

  if (sectionId && UUID.test(sectionId)) {
    const result = await gatewayFetch<{ name?: string; code?: string }>(
      `/timetable/sections/${encodeURIComponent(sectionId)}`,
      { throwOnError: false, cache: 'no-store' },
    );
    const name = readName(result.data);
    if (result.ok && name) {
      return NextResponse.json({ name }, { headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.json({ name: null }, { status: result.status || 404 });
  }

  if (transferId && UUID.test(transferId)) {
    const result = await gatewayFetch<{ studentName?: string }>(
      `/transfers/${encodeURIComponent(transferId)}`,
      { throwOnError: false, cache: 'no-store' },
    );
    const name = result.data?.studentName?.trim() || null;
    if (result.ok && name) {
      return NextResponse.json({ name }, { headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.json({ name: null }, { status: result.status || 404 });
  }

  return NextResponse.json({ name: null }, { status: 400 });
}
