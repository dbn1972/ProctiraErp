import { getSelfAttendance } from '@/lib/api/parent-portal';
import { AcademicFrame } from '../../../(parent)/parent/_components/academic-frame';
import { requireStudentSession, studentStatus } from '../_lib/session';

export const dynamic = 'force-dynamic';

export default async function StudentAttendancePage() {
  await requireStudentSession();
  const result = await getSelfAttendance();
  const days = result.payload?.data ?? [];
  const summary = result.payload?.summary;

  return (
    <AcademicFrame
      title="Attendance"
      description="Your recent days and overall percentage."
      testId="student-attendance"
      status={studentStatus(result)}
      errorMessage={result.message}
      emptyMessage="No attendance has been recorded yet."
      hasRows={days.length > 0}
    >
      <div className="space-y-4">
        {summary ? (
          <p className="text-sm text-foreground">
            {summary.percentage == null ? 'No percentage yet.' : `${summary.percentage}% present`} ·{' '}
            {summary.present} present · {summary.absent} absent
          </p>
        ) : null}
        <ul className="divide-y divide-border" role="list">
          {days.map((day) => (
            <li key={`${day.date}-${day.classId ?? 'n'}`} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-foreground">{day.date}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{day.status}</p>
            </li>
          ))}
        </ul>
      </div>
    </AcademicFrame>
  );
}
