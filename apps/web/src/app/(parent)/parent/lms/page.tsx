import { requireSession } from '@/lib/auth/server';
import { getChildLms, listChildren } from '@/lib/api/parent-portal';
import { AcademicFrame, firstSearchParam, pickChild } from '../_components/academic-frame';

export const dynamic = 'force-dynamic';

export default async function ParentLmsPage({
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
        title="LMS"
        description="Course assignments, submissions, and scores for your child."
        testId="parent-lms"
        status="empty-children"
        emptyMessage="No LMS activity to show."
        hasRows={false}
      >
        {null}
      </AcademicFrame>
    );
  }

  const result = await getChildLms(child.studentId);
  const items = result.payload?.data ?? [];
  const summary = result.payload?.summary;
  const status = !result.ok
    ? result.status === 403 || result.status === 404
      ? 'forbidden'
      : 'error'
    : 'ok';

  return (
    <AcademicFrame
      title="LMS"
      description="Course assignments, submissions, and scores for your child."
      testId="parent-lms"
      childrenLinks={children}
      selectedId={child.studentId}
      status={status}
      errorMessage={result.message}
      emptyMessage="No published LMS assignments yet."
      hasRows={items.length > 0}
    >
      <div className="space-y-6">
        {summary ? (
          <p className="text-xs text-muted-foreground" data-testid="parent-lms-summary">
            {summary.assigned} assigned · {summary.submitted} submitted · {summary.graded} graded ·{' '}
            {summary.missing} missing
            {summary.averageScorePercent != null ? ` · avg ${summary.averageScorePercent}%` : ''}
          </p>
        ) : null}
        <ul className="divide-y divide-border" role="list">
          {items.map((item) => (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.kind}
                {item.subject ? ` · ${item.subject}` : ''}
                {item.submissionStatus ? ` · ${item.submissionStatus}` : ' · not submitted'}
                {item.score != null
                  ? ` · ${item.score}${item.maxScore != null ? ` / ${item.maxScore}` : ''}`
                  : ''}
                {item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ''}
              </p>
              {item.feedback ? (
                <p className="mt-1 text-xs text-muted-foreground">{item.feedback}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </AcademicFrame>
  );
}
