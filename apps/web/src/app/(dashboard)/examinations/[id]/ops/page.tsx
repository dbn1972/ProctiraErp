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
  listExaminationCandidates,
} from '@/lib/api/examinations';
import {
  loadStaffDirectory,
  loadStudentOptions,
  withStaffLabels,
  withStudentLabels,
} from '@/lib/load-entity-labels';
import { examinationCandidateLabel } from '@/lib/ux/display-references';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ExaminationOpsPage(props: PageProps) {
  const params = await props.params;
  const examination = await getExamination(params.id);
  if (!examination) notFound();

  const [sessions, seats, marks, reevaluations, candidates, studentOptions, staffDirectory] =
    await Promise.all([
      listExamSessions(examination.id),
      listExamSeating(examination.id),
      listExamMarksPairs(examination.id),
      listExamReevaluations(examination.id),
      listExaminationCandidates(examination.id),
      loadStudentOptions(),
      loadStaffDirectory(),
    ]);
  const staffOptions = staffDirectory.options;

  const invigilatorsBySession: Record<
    string,
    Awaited<ReturnType<typeof listExamInvigilators>>
  > = {};
  await Promise.all(
    sessions.map(async (session) => {
      invigilatorsBySession[session.id] = await listExamInvigilators(examination.id, session.id);
    }),
  );

  // PRC-M083: resolve candidates / staff beyond the first directory page by id.
  const studentLabels = await withStudentLabels(
    new Map(studentOptions.map((option) => [option.id, option.label])),
    candidates.map((candidate) => candidate.studentId),
  );
  const candidateOptions = candidates.map((candidate) => ({
    id: candidate.id,
    label: examinationCandidateLabel(studentLabels.get(candidate.studentId)),
    searchText: candidate.studentId,
  }));
  const candidateLabels = new Map(candidateOptions.map((option) => [option.id, option.label]));
  const staffLabels = await withStaffLabels(
    new Map(staffOptions.map((option) => [option.id, option.label])),
    [
      ...Object.values(invigilatorsBySession).flatMap((rows) => rows.map((inv) => inv.staffId)),
      ...reevaluations.map((row) => row.evaluatorId),
    ],
  );

  return (
    <ExamOpsPanel
      examination={examination}
      sessions={sessions}
      invigilatorsBySession={invigilatorsBySession}
      seats={seats}
      marks={marks}
      reevaluations={reevaluations}
      staffLabels={Object.fromEntries(staffLabels)}
      candidateLabels={Object.fromEntries(candidateLabels)}
      staffOptions={staffOptions}
      staffTotal={staffDirectory.total}
      candidateOptions={candidateOptions}
    />
  );
}
