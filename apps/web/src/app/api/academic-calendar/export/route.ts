/**
 * G-905 / G-925 — iCalendar export of the tenant's academic calendar.
 *
 * Periods (years + terms) and their calendar events (holidays, breaks,
 * grading / exam windows) as all-day VEVENTs. Authenticated through the
 * session cookie; `?periodId=` limits the feed to one period and its events.
 */
import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/api/gateway';
import { ApiClientError, listAcademicPeriods, listCalendarEvents } from '@/lib/institutions/api';
import { renderAcademicCalendarIcs } from '@/lib/institutions/ics';
import type { CalendarEvent } from '@/lib/institutions/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  const { tenantId, accessToken } = await getSessionContext();
  if (!accessToken) {
    return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Sign in' }, { status: 401 });
  }

  const periodId = new URL(request.url).searchParams.get('periodId');
  if (periodId && !UUID_RE.test(periodId)) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Invalid period id' },
      { status: 400 },
    );
  }

  try {
    const all = await listAcademicPeriods();
    const periods = periodId
      ? all.filter((p) => p.id === periodId || p.parentId === periodId)
      : all;
    if (periodId && periods.length === 0) {
      return NextResponse.json({ code: 'NOT_FOUND', message: 'Period not found' }, { status: 404 });
    }
    const events: CalendarEvent[] = (
      await Promise.all(periods.map((p) => listCalendarEvents(p.id).catch(() => [])))
    ).flat();

    const body = renderAcademicCalendarIcs({ tenantId, periods, events });
    const filename = periodId ? `academic-calendar-${periodId}.ics` : 'academic-calendar.ics';
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    const status = error instanceof ApiClientError && error.statusCode ? error.statusCode : 502;
    return NextResponse.json(
      {
        code: 'UPSTREAM_ERROR',
        message: error instanceof Error ? error.message : 'Calendar export failed',
      },
      { status: status >= 400 && status < 600 ? status : 502 },
    );
  }
}
