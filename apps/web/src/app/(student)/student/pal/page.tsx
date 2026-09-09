import { getSelfPalPlan } from '@/lib/api/parent-portal';
import { AcademicFrame } from '../../../(parent)/parent/_components/academic-frame';
import { requireStudentSession, studentStatus } from '../_lib/session';

export const dynamic = 'force-dynamic';

export default async function StudentPalPage() {
  await requireStudentSession();
  const result = await getSelfPalPlan();
  const items = result.payload?.data ?? [];

  return (
    <AcademicFrame
      title="PAL plan"
      description="Today’s Spiral PAL reviews, reinforce, and introduce skills."
      testId="student-pal"
      status={studentStatus(result)}
      errorMessage={result.message}
      emptyMessage="No practice plan yet. Skills appear here after quizzes and practice."
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
            </p>
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
