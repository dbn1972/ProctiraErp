/**
 * PRC-H056: build a candidate's certificate read-model from graded results and
 * the examination's subject list, so missing/ungraded subjects make the overall
 * result INCOMPLETE instead of silently certifying a pass over fewer subjects.
 */
import type { CandidateResultData } from './document-repository.js';
import type { ExaminationSubject } from './examination-repository.js';
import type { CandidateGradeResult } from './result-repository.js';

export const INCOMPLETE_OVERALL_GRADE = 'INCOMPLETE';

export function buildCandidateResultData(input: {
  candidateId: string;
  studentId: string;
  studentName: string;
  gradeResults: CandidateGradeResult[];
  /** Registered subjects for the candidate (the examination's subject list). */
  subjects: Pick<ExaminationSubject, 'id' | 'name' | 'maxScore'>[];
  /** Subject ids flagged incomplete at publication. */
  incompleteSubjectIds?: Iterable<string>;
}): CandidateResultData {
  const flagged = new Set(input.incompleteSubjectIds ?? []);
  const graded = new Map(input.gradeResults.map((r) => [r.subjectId, r]));
  const subjectById = new Map(input.subjects.map((s) => [s.id, s]));

  const rows = input.gradeResults.map((r) => ({
    name: subjectById.get(r.subjectId)?.name ?? r.subjectId,
    score: r.score,
    grade: r.grade,
    passed: r.passed,
  }));

  const incompleteSubjects = input.subjects
    .filter((s) => !graded.has(s.id) || flagged.has(s.id))
    .map((s) => s.name);
  for (const subjectId of flagged) {
    if (!subjectById.has(subjectId)) incompleteSubjects.push(subjectId);
  }

  const incomplete = incompleteSubjects.length > 0;
  const overallPassed = !incomplete && rows.length > 0 && rows.every((s) => s.passed);
  return {
    candidateId: input.candidateId,
    studentId: input.studentId,
    studentName: input.studentName,
    rollNumber: input.candidateId,
    subjects: rows,
    overallGrade: incomplete ? INCOMPLETE_OVERALL_GRADE : overallPassed ? 'PASS' : 'FAIL',
    overallPassed,
    totalScore: rows.reduce((sum, s) => sum + s.score, 0),
    // Max possible is computed over every registered subject, not only graded ones.
    maxPossibleScore: input.subjects.reduce((sum, s) => sum + s.maxScore, 0),
    incompleteSubjects,
  };
}
