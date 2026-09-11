import { requireSession } from '@/lib/auth/server';
import { getChildReportCards, listChildren } from '@/lib/api/parent-portal';
import { AcademicFrame, firstSearchParam, pickChild } from '../_components/academic-frame';

export const dynamic = 'force-dynamic';

export default async function ParentReportCardsPage({
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
        title="Report cards"
        description="Subject lines from completed report cards."
        testId="parent-report-cards"
        status="empty-children"
        emptyMessage="No report cards to show."
        hasRows={false}
      >
        {null}
      </AcademicFrame>
    );
  }

  const result = await getChildReportCards(child.studentId);
  const cards = result.payload?.data ?? [];
  const status = !result.ok
    ? result.status === 403 || result.status === 404
      ? 'forbidden'
      : 'error'
    : 'ok';

  return (
    <AcademicFrame
      title="Report cards"
      description="Subject lines from completed report cards."
      testId="parent-report-cards"
      childrenLinks={children}
      selectedId={child.studentId}
      status={status}
      errorMessage={result.message}
      emptyMessage="No completed report cards yet."
      hasRows={cards.length > 0}
    >
      <div className="space-y-8">
        {cards.map((card) => (
          <section key={card.id} className="space-y-3" aria-label={`Report card ${card.status}`}>
            <div>
              <p className="text-sm font-medium text-foreground">Report card · {card.status}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {card.completedAt
                  ? `Completed ${new Date(card.completedAt).toLocaleDateString()}`
                  : 'Completion date pending'}
                {card.outputUrl ? ' · download available from school' : ''}
              </p>
            </div>
            {card.subjects.length > 0 ? (
              <ul className="divide-y divide-border" role="list">
                {card.subjects.map((line) => (
                  <li key={`${card.id}-${line.subject}`} className="py-2 first:pt-0 last:pb-0">
                    <p className="text-sm font-medium text-foreground">
                      {line.subject} · {line.letterGrade ?? line.numericScore ?? '—'}
                    </p>
                    {line.remarks ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{line.remarks}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                Subject lines are not available for this card yet.
              </p>
            )}
          </section>
        ))}
      </div>
    </AcademicFrame>
  );
}
