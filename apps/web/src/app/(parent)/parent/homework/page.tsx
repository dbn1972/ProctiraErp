import { requireSession } from '@/lib/auth/server';
import { getChildHomework, listChildren } from '@/lib/api/parent-portal';
import { AcademicFrame, firstSearchParam, pickChild } from '../_components/academic-frame';

export const dynamic = 'force-dynamic';

export default async function ParentHomeworkPage({
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
        title="Homework"
        description="Assignments and quizzes that are due."
        testId="parent-homework"
        status="empty-children"
        emptyMessage="No homework to show."
        hasRows={false}
      >
        {null}
      </AcademicFrame>
    );
  }

  const result = await getChildHomework(child.studentId);
  const items = result.payload?.data ?? [];
  const status = !result.ok
    ? result.status === 403 || result.status === 404
      ? 'forbidden'
      : 'error'
    : 'ok';

  return (
    <AcademicFrame
      title="Homework"
      description="Assignments and quizzes that are due."
      testId="parent-homework"
      childrenLinks={children}
      selectedId={child.studentId}
      status={status}
      errorMessage={result.message}
      emptyMessage="No published homework yet."
      hasRows={items.length > 0}
    >
      <ul className="divide-y divide-border" role="list">
        {items.map((item) => (
          <li key={item.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {item.kind}
              {item.subject ? ` · ${item.subject}` : ''}
              {item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
