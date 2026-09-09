import { getSelfHomework } from '@/lib/api/parent-portal';
import { AcademicFrame } from '../../../(parent)/parent/_components/academic-frame';
import { requireStudentSession, studentStatus } from '../_lib/session';

export const dynamic = 'force-dynamic';

export default async function StudentHomeworkPage() {
  await requireStudentSession();
  const result = await getSelfHomework();
  const items = result.payload?.data ?? [];

  return (
    <AcademicFrame
      title="Homework"
      description="Assignments and quizzes that are due."
      testId="student-homework"
      status={studentStatus(result)}
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
              {item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
