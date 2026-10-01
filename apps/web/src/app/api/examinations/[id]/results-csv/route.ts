/**
 * PRC-L236 — on-demand results CSV download. The results page links here so
 * marks are only fetched when the user clicks "Download CSV", instead of
 * serialising every candidate's marks into the page payload.
 */
import { NextResponse } from 'next/server';
import { getExamination, getExaminationResultsView } from '@/lib/api/examinations';
import { canAccessExaminationRoutes } from '@/lib/auth/examination-route-guards';
import { getSession } from '@/lib/auth/server';
import { buildResultsCsv } from '@/lib/examinations/results-csv';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'Invalid id' }, { status: 400 });
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
  const examination = await getExamination(id);
  if (!examination) {
    return NextResponse.json({ code: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
  }
  const view = await getExaminationResultsView(examination);
  const filename = `${examination.code.replace(/[^A-Za-z0-9._-]/g, '_')}-results.csv`;
  return new NextResponse(buildResultsCsv(view), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });
}
