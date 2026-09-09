import { getSelfTimetable } from '@/lib/api/parent-portal';
import { AcademicFrame } from '../../../(parent)/parent/_components/academic-frame';
import { requireStudentSession, studentStatus } from '../_lib/session';

export const dynamic = 'force-dynamic';

const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default async function StudentTimetablePage() {
  await requireStudentSession();
  const result = await getSelfTimetable();
  const slots = result.payload?.data ?? [];

  return (
    <AcademicFrame
      title="Timetable"
      description="Your class meetings for the current term."
      testId="student-timetable"
      status={studentStatus(result)}
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
              {slot.roomName ? ` · ${slot.roomName}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
