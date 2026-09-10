import { getSelfTimetable } from '@/lib/api/parent-portal';
import { TimetableWeeklyGrid } from '@/components/timetable/weekly-grid';
import { AcademicFrame } from '../../../(parent)/parent/_components/academic-frame';
import { requireStudentSession, studentStatus } from '../_lib/session';

export const dynamic = 'force-dynamic';

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
      <TimetableWeeklyGrid slots={slots} />
    </AcademicFrame>
  );
}
