import { requireSession } from '@/lib/auth/server';
import { getChildTimetable, listChildren } from '@/lib/api/parent-portal';
import { TimetableWeeklyGrid } from '@/components/timetable/weekly-grid';
import { AcademicFrame, firstSearchParam, pickChild } from '../_components/academic-frame';

export const dynamic = 'force-dynamic';

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
      <TimetableWeeklyGrid slots={slots} />
    </AcademicFrame>
  );
}
