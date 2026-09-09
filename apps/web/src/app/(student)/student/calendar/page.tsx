import { getSelfCalendar } from '@/lib/api/parent-portal';
import { AcademicFrame } from '../../../(parent)/parent/_components/academic-frame';
import { requireStudentSession, studentStatus } from '../_lib/session';

export const dynamic = 'force-dynamic';

export default async function StudentCalendarPage() {
  await requireStudentSession();
  const result = await getSelfCalendar();
  const events = result.payload?.data ?? [];

  return (
    <AcademicFrame
      title="Calendar"
      description="Holidays, breaks, and school events for your period."
      testId="student-calendar"
      status={studentStatus(result)}
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
            </p>
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
