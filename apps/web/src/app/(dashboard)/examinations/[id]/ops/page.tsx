/**
 * Examination ops tab — sessions/invigilators, seating, double entry, appeal/re-eval (G-908).
 * IA: appeal ≡ re-evaluation; malpractice / formal appeals beyond re-eval = PRD-017 NON-GOAL.
 */
import { notFound } from 'next/navigation';

import { ExamOpsPanel } from '@/components/examinations/exam-ops-panel';
import {
  getExamination,
  listExamInvigilators,
  listExamMarksPairs,
  listExamReevaluations,
  listExamSeating,
  listExamSessions,
} from '@/lib/api/examinations';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ExaminationOpsPage(props: PageProps) {
  const params = await props.params;
  const examination = await getExamination(params.id);
  if (!examination) notFound();

  const [sessions, seats, marks, reevaluations] = await Promise.all([
    listExamSessions(examination.id),
    listExamSeating(examination.id),
    listExamMarksPairs(examination.id),
    listExamReevaluations(examination.id),
  ]);

  const invigilatorsBySession: Record<
    string,
    Awaited<ReturnType<typeof listExamInvigilators>>
  > = {};
  await Promise.all(
    sessions.map(async (session) => {
      invigilatorsBySession[session.id] = await listExamInvigilators(examination.id, session.id);
    }),
  );

  return (
    <ExamOpsPanel
      examination={examination}
      sessions={sessions}
      invigilatorsBySession={invigilatorsBySession}
      seats={seats}
      marks={marks}
      reevaluations={reevaluations}
    />
  );
}
