import { requireSession } from '@/lib/auth/server';
import { getChildTimetable, listChildren } from '@/lib/api/parent-portal';
import { AcademicFrame, firstSearchParam, pickChild } from '../_components/academic-frame';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default async function ParentTimetablePage({
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
        title="Timetable"
        description="Class meetings for the current term."
        testId="parent-timetable"
        status="empty-children"
        emptyMessage="No timetable to show."
        hasRows={false}
      >
        {null}
      </AcademicFrame>
    );
  }

  const result = await getChildTimetable(child.studentId);
  const slots = result.payload?.data ?? [];
  const status = !result.ok
    ? result.status === 403 || result.status === 404
      ? 'forbidden'
      : 'error'
    : 'ok';

  return (
    <AcademicFrame
      title="Timetable"
      description="Class meetings for the current term."
      testId="parent-timetable"
      childrenLinks={children}
      selectedId={child.studentId}
      status={status}
      errorMessage={result.message}
      emptyMessage="No published class meetings yet."
      hasRows={slots.length > 0}
    >
      <ul className="divide-y divide-border" role="list">
        {slots.map((slot) => (
          <li key={slot.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">
              {slot.sectionName ?? 'Class'} · {WEEKDAYS[slot.dayOfWeek] ?? `Day ${slot.dayOfWeek}`}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {slot.periodName ?? 'Period'}
              {slot.startTime ? ` · ${slot.startTime}` : ''}
              {slot.roomName ? ` · ${slot.roomName}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
