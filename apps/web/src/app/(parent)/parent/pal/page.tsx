import { requireSession } from '@/lib/auth/server';
import { getChildPalPlan, listChildren } from '@/lib/api/parent-portal';
import { AcademicFrame, firstSearchParam, pickChild } from '../_components/academic-frame';

export const dynamic = 'force-dynamic';

export default async function ParentPalPage({
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
        title="PAL plan"
        description="Spiral PAL skills to review, reinforce, and introduce."
        testId="parent-pal"
        status="empty-children"
        emptyMessage="No PAL plan to show."
        hasRows={false}
      >
        {null}
      </AcademicFrame>
    );
  }

  const result = await getChildPalPlan(child.studentId);
  const items = result.payload?.data ?? [];
  const status = !result.ok
    ? result.status === 403 || result.status === 404
      ? 'forbidden'
      : 'error'
    : 'ok';

  return (
    <AcademicFrame
      title="PAL plan"
      description="Spiral PAL skills to review, reinforce, and introduce."
      testId="parent-pal"
      childrenLinks={children}
      selectedId={child.studentId}
      status={status}
      errorMessage={result.message}
      emptyMessage="No practice plan yet. Skills appear after quizzes and practice."
      hasRows={items.length > 0}
    >
      <ul className="divide-y divide-border" role="list">
        {items.map((item) => (
          <li key={item.skillId} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">{item.skillName ?? 'Skill'}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {item.bucket}
              {item.subject ? ` · ${item.subject}` : ''}
              {item.mastery != null ? ` · mastery ${Math.round(item.mastery * 100)}%` : ''}
              {item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
