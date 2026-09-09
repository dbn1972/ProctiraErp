import { requireSession } from '@/lib/auth/server';
import { getChildCalendar, listChildren } from '@/lib/api/parent-portal';
import { AcademicFrame, firstSearchParam, pickChild } from '../_components/academic-frame';

export const dynamic = 'force-dynamic';

export default async function ParentCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  const params = await searchParams;
  const children = await listChildren();
  const child = pickChild(children, firstSearchParam(params.studentId));

  if (!child) {
    return (
      <AcademicFrame
        title="Calendar"
        description="Holidays, breaks, and school events for the current period."
        testId="parent-calendar"
        status="empty-children"
        emptyMessage="No calendar to show."
        hasRows={false}
      >
        {null}
      </AcademicFrame>
    );
  }

  const result = await getChildCalendar(child.studentId);
  const events = result.payload?.data ?? [];
  const status = !result.ok
    ? result.status === 403 || result.status === 404
      ? 'forbidden'
      : 'error'
    : 'ok';

  return (
    <AcademicFrame
      title="Calendar"
      description="Holidays, breaks, and school events for the current period."
      testId="parent-calendar"
      childrenLinks={children}
      selectedId={child.studentId}
      status={status}
      errorMessage={result.message}
      emptyMessage="No holidays or events have been published yet."
      hasRows={events.length > 0}
    >
      <ul className="divide-y divide-border" role="list">
        {events.map((event) => (
          <li key={event.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">{event.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {event.kind} · {event.startDate}
              {event.endDate !== event.startDate ? ` – ${event.endDate}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
