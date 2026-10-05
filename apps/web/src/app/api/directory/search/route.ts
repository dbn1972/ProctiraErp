/**
 * Same-origin directory search for async pickers (PRC-M083).
 *
 * The capped first page used to seed `EntitySearchSelect` cannot hold a
 * large tenant's directory, so pickers call this route to search the full
 * student / staff directory server-side. The access token cookie is forwarded
 * by `gatewayFetch`; the gateway enforces tenant scope and permissions.
 * Returns labels only (id + display label), never full records.
 *
 * GET /api/directory/search?kind=student|staff|person&q=<2..100 chars>
 */
import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth/server';
import { listStaff } from '@/lib/api/staff';
import { listStudents } from '@/lib/api/students';
import { formatPersonLabel, type EntityLabelOption } from '@/lib/entity-label';

const RESULT_LIMIT = 20;
const KINDS = new Set(['student', 'staff', 'person']);

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ data: [], message: 'Not signed in' }, { status: 401 });
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!KINDS.has(kind) || q.length < 2 || q.length > 100) {
    return NextResponse.json({ data: [], message: 'Invalid search' }, { status: 400 });
  }

  const tasks: Array<Promise<EntityLabelOption[]>> = [];
  if (kind === 'student' || kind === 'person') {
    tasks.push(
      listStudents({ search: q, pageSize: RESULT_LIMIT }).then((r) =>
        (r.data ?? []).map((s) => ({
          id: s.id,
          label: formatPersonLabel(s.firstName, s.lastName, s.nationalId),
          searchText: `${s.firstName} ${s.lastName} ${s.nationalId ?? ''}`,
        })),
      ),
    );
  }
  if (kind === 'staff' || kind === 'person') {
    tasks.push(
      listStaff({ search: q, pageSize: RESULT_LIMIT }).then((r) =>
        (r.data ?? []).map((s) => ({
          id: s.id,
          label: formatPersonLabel(s.firstName, s.lastName, s.position),
          searchText: `${s.firstName} ${s.lastName} ${s.position ?? ''}`,
        })),
      ),
    );
  }
  const settled = await Promise.allSettled(tasks);
  if (settled.every((r) => r.status === 'rejected')) {
    return NextResponse.json({ data: [], message: 'Directory unavailable' }, { status: 502 });
  }
  const data = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  return NextResponse.json({ data }, { headers: { 'cache-control': 'no-store' } });
}
