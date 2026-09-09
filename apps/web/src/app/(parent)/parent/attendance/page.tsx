import { requireSession } from '@/lib/auth/server';
import { getChildAttendance, listChildren } from '@/lib/api/parent-portal';
import { AcademicFrame, firstSearchParam, pickChild } from '../_components/academic-frame';

export const dynamic = 'force-dynamic';

export default async function ParentAttendancePage({
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
        title="Attendance"
        description="See presence, absences, and recent days for your child."
        testId="parent-attendance"
        status="empty-children"
        emptyMessage="No attendance to show."
        hasRows={false}
      >
        {null}
      </AcademicFrame>
    );
  }

  const result = await getChildAttendance(child.studentId);
  const days = result.payload?.data ?? [];
  const summary = result.payload?.summary;
  const status = !result.ok
    ? result.status === 403 || result.status === 404
      ? 'forbidden'
      : 'error'
    : 'ok';

  return (
    <AcademicFrame
      title="Attendance"
      description="See presence, absences, and recent days for your child."
      testId="parent-attendance"
      childrenLinks={children}
      selectedId={child.studentId}
      status={status}
      errorMessage={result.message}
      emptyMessage="The school has not recorded attendance days yet."
      hasRows={days.length > 0}
    >
      <div className="space-y-4">
        {summary ? (
          <p className="text-sm text-foreground">
            {summary.percentage == null
              ? 'No percentage yet.'
              : `${summary.percentage}% present`}{' '}
            · {summary.present} present · {summary.absent} absent · {summary.late} late
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
