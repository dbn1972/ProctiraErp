/**
 * Validation gate for board export packs — incomplete grades → 422.
 */
import { BusinessRuleError } from '@proctira/common';

import type { BoardPackDefinition } from './board-pack-registry.js';
import type { BoardExportCandidate } from './gradebook-repository.js';

export type IncompleteGradeDetail = {
  studentId: string;
  nationalId: string | null;
  missingSubjects: string[];
};

export type BoardExportValidationResult =
  | { ok: true }
  | { ok: false; incomplete: IncompleteGradeDetail[] };

function gradeComplete(candidate: BoardExportCandidate, subject: string): boolean {
  const entry = candidate.grades.find(
    (g) => (g.assessmentCode ?? '').toUpperCase() === subject.toUpperCase(),
  );
  if (!entry) return false;
  return entry.numericScore != null || (entry.letterGrade != null && entry.letterGrade.length > 0);
}

export function validateBoardExportCompleteness(
  pack: BoardPackDefinition,
  candidates: BoardExportCandidate[],
): BoardExportValidationResult {
  if (candidates.length === 0) {
    return {
      ok: false,
      incomplete: [
        {
          studentId: '*',
          nationalId: null,
          missingSubjects: [...pack.requiredSubjects],
        },
      ],
    };
  }

  const incomplete: IncompleteGradeDetail[] = [];
  for (const candidate of candidates) {
    const missing = pack.requiredSubjects.filter((subj) => !gradeComplete(candidate, subj));
    if (missing.length > 0) {
      incomplete.push({
        studentId: candidate.studentId,
        nationalId: candidate.nationalId,
        missingSubjects: missing,
      });
    }
  }

  if (incomplete.length > 0) {
    return { ok: false, incomplete };
  }
  return { ok: true };
}

export function assertBoardExportCompleteness(
  pack: BoardPackDefinition,
  candidates: BoardExportCandidate[],
): void {
  const result = validateBoardExportCompleteness(pack, candidates);
  if (result.ok) return;

  const sample = result.incomplete
    .slice(0, 5)
    .map((row) => `${row.nationalId ?? row.studentId}: missing ${row.missingSubjects.join(',')}`)
    .join('; ');

  throw new BusinessRuleError(
    `Incomplete grades for ${pack.code} pack (${result.incomplete.length} candidate(s)). ${sample}`,
  );
}
