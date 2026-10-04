/**
 * PRC-H056: build a candidate's certificate read-model from graded results and
 * the candidate's registered subjects, so missing/ungraded subjects make the overall
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
  /** The examination's subject list (names and maxScore lookup). */
  subjects: Pick<ExaminationSubject, 'id' | 'name' | 'maxScore'>[];
  /**
   * The candidate's registered subject ids (registration `subjectIds`). When
   * provided, only these subjects are required; otherwise every examination
   * subject is (legacy candidates without a registration).
   */
  registeredSubjectIds?: Iterable<string>;
  /** Subject ids flagged incomplete at publication. */
  incompleteSubjectIds?: Iterable<string>;
}): CandidateResultData {
  const flagged = new Set(input.incompleteSubjectIds ?? []);
  const graded = new Map(input.gradeResults.map((r) => [r.subjectId, r]));
  const subjectById = new Map(input.subjects.map((s) => [s.id, s]));
  const required = requiredSubjects(input.subjects, input.registeredSubjectIds);
  const requiredIds = new Set(required.map((s) => s.id));

  // Only registered subjects are certified (a stray mark for an unregistered
  // subject must not inflate totalScore past maxPossibleScore).
  const rows = input.gradeResults
    .filter((r) => requiredIds.has(r.subjectId))
    .map((r) => ({
      name: subjectById.get(r.subjectId)?.name ?? r.subjectId,
      score: r.score,
      grade: r.grade,
      passed: r.passed,
    }));

  const incompleteSubjects = required
    .filter((s) => !graded.has(s.id) || flagged.has(s.id))
    .map((s) => s.name);
  for (const subjectId of flagged) {
    if (!requiredIds.has(subjectId)) {
      incompleteSubjects.push(subjectById.get(subjectId)?.name ?? subjectId);
    }
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
    maxPossibleScore: required.reduce((sum, s) => sum + s.maxScore, 0),
    incompleteSubjects,
  };
}

/**
 * PRC-H056: the candidate's required subject set — registration subjectIds
 * when known (unknown ids are kept, with maxScore 0, so they surface as
 * incomplete rather than vanish), otherwise every examination subject.
 */
export function requiredSubjects<S extends Pick<ExaminationSubject, 'id' | 'name' | 'maxScore'>>(
  subjects: S[],
  registeredSubjectIds?: Iterable<string>,
): Pick<ExaminationSubject, 'id' | 'name' | 'maxScore'>[] {
  if (!registeredSubjectIds) return subjects;
  const byId = new Map(subjects.map((s) => [s.id, s]));
  return [...new Set(registeredSubjectIds)].map(
    (id) => byId.get(id) ?? { id, name: id, maxScore: 0 },
  );
}
