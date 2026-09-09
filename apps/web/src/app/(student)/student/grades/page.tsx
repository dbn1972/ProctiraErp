import { getSelfGrades } from '@/lib/api/parent-portal';
import { AcademicFrame } from '../../../(parent)/parent/_components/academic-frame';
import { requireStudentSession, studentStatus } from '../_lib/session';

export const dynamic = 'force-dynamic';

export default async function StudentGradesPage() {
  await requireStudentSession();
  const result = await getSelfGrades();
  const grades = result.payload?.data ?? [];
  const reportCards = result.payload?.reportCards ?? [];

  return (
    <AcademicFrame
      title="Grades"
      description="Published marks and report cards for you."
      testId="student-grades"
      status={studentStatus(result)}
      errorMessage={result.message}
      emptyMessage="No published grades yet."
      hasRows={grades.length + reportCards.length > 0}
    >
      <ul className="divide-y divide-border" role="list">
        {grades.map((grade) => (
          <li key={grade.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">
              {grade.assessmentCode ?? 'Assessment'} · {grade.letterGrade ?? grade.numericScore ?? '—'}
            </p>
          </li>
        ))}
        {reportCards.map((card) => (
          <li key={card.id} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-foreground">Report card</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{card.status}</p>
          </li>
        ))}
      </ul>
    </AcademicFrame>
  );
}
