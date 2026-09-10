import { requireSession } from '@/lib/auth/server';
import { getChildGrades, listChildren } from '@/lib/api/parent-portal';
import { AcademicFrame, firstSearchParam, pickChild } from '../_components/academic-frame';

export const dynamic = 'force-dynamic';

export default async function ParentGradesPage({
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
        title="Grades"
        description="Published marks and report cards for your child."
        testId="parent-grades"
        status="empty-children"
        emptyMessage="No grades to show."
        hasRows={false}
      >
        {null}
      </AcademicFrame>
    );
  }

  const result = await getChildGrades(child.studentId);
  const grades = result.payload?.data ?? [];
  const reportCards = result.payload?.reportCards ?? [];
  const status = !result.ok
    ? result.status === 403 || result.status === 404
      ? 'forbidden'
      : 'error'
    : 'ok';

  return (
    <AcademicFrame
      title="Grades"
      description="Published marks and report cards for your child."
      testId="parent-grades"
      childrenLinks={children}
      selectedId={child.studentId}
      status={status}
      errorMessage={result.message}
      emptyMessage="No published grades or report cards yet."
      hasRows={grades.length + reportCards.length > 0}
    >
      <div className="space-y-6">
        {grades.length > 0 ? (
          <ul className="divide-y divide-border" role="list">
            {grades.map((grade) => (
              <li key={grade.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium text-foreground">
                  {grade.assessmentCode ?? 'Assessment'} ·{' '}
                  {grade.letterGrade ?? grade.numericScore ?? '—'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{grade.workflowStatus}</p>
              </li>
            ))}
          </ul>
        ) : null}
        {reportCards.length > 0 ? (
          <ul className="divide-y divide-border" role="list">
            {reportCards.map((card) => (
              <li key={card.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium text-foreground">Report card</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{card.status}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </AcademicFrame>
  );
}
