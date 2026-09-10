/**
 * LMS grading + analytics (Wave 9 / G-915). Pure functions — no I/O.
 */
export type QuestionType = 'mcq' | 'msq' | 'numeric' | 'match' | 'essay';
export type MsqCreditMode = 'all_or_nothing' | 'partial';

export interface MatchPair {
  leftIndex: number;
  rightIndex: number;
}

export interface RubricCriterionScore {
  criterionId: string;
  points: number;
  maxPoints: number;
}

export interface GradedItem {
  questionId: string;
  questionType: QuestionType;
  score: number;
  maxScore: number;
  correct: boolean;
  skillId: string | null;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function gradeMcq(
  correctOptionIndex: number,
  selected: number | undefined,
  points: number,
): { score: number; correct: boolean } {
  const correct = selected !== undefined && selected === correctOptionIndex;
  return { score: correct ? points : 0, correct };
}

export function gradeMsq(
  correctIndexes: readonly number[],
  selected: readonly number[] | undefined,
  points: number,
  mode: MsqCreditMode = 'all_or_nothing',
): { score: number; correct: boolean } {
  const chosen = selected ?? [];
  const correctSet = new Set(correctIndexes);
  const selectedSet = new Set(chosen);
  if (mode === 'all_or_nothing') {
    const exact =
      correctSet.size === selectedSet.size && [...correctSet].every((i) => selectedSet.has(i));
    return { score: exact ? points : 0, correct: exact };
  }
  const truePos = [...selectedSet].filter((i) => correctSet.has(i)).length;
  const falsePos = [...selectedSet].filter((i) => !correctSet.has(i)).length;
  const fraction = Math.max(0, Math.min(1, (truePos - falsePos) / Math.max(correctSet.size, 1)));
  return { score: round4(points * fraction), correct: fraction === 1 };
}

export function gradeNumeric(
  correctValue: number,
  tolerance: number,
  given: number | undefined,
  points: number,
): { score: number; correct: boolean } {
  if (given === undefined || Number.isNaN(given) || Number.isNaN(correctValue)) {
    return { score: 0, correct: false };
  }
  const correct = Math.abs(given - correctValue) <= Math.abs(tolerance);
  return { score: correct ? points : 0, correct };
}

export function gradeMatch(
  key: readonly MatchPair[],
  given: readonly MatchPair[] | undefined,
  points = 1,
): { score: number; correct: boolean } {
  if (key.length === 0) return { score: 0, correct: false };
  const givenMap = new Map((given ?? []).map((p) => [p.leftIndex, p.rightIndex]));
  let hits = 0;
  for (const pair of key) {
    if (givenMap.get(pair.leftIndex) === pair.rightIndex) hits += 1;
  }
  const fraction = hits / key.length;
  return { score: round4(points * fraction), correct: hits === key.length };
}

export function rubricTotal(scores: readonly RubricCriterionScore[]): {
  score: number;
  maxScore: number;
} {
  let score = 0;
  let maxScore = 0;
  for (const row of scores) {
    score += Math.max(0, Math.min(row.points, row.maxPoints));
    maxScore += row.maxPoints;
  }
  return { score: round4(score), maxScore: round4(maxScore) };
}

export function gradeEssay(
  scores: readonly RubricCriterionScore[],
  points: number,
): { score: number; correct: boolean } {
  const { score, maxScore } = rubricTotal(scores);
  if (maxScore <= 0) return { score: 0, correct: false };
  const scaled = round4((score / maxScore) * points);
  return { score: scaled, correct: score / maxScore >= 0.6 };
}

export interface BankLikeQuestion {
  id: string;
  questionType: QuestionType;
  points: number;
  skillId: string | null;
  correctOptionIndex: number | null;
  payload: Record<string, unknown>;
}

export interface QuizAnswerLike {
  questionId: string;
  selectedOptionIndex?: number;
  selectedOptionIndexes?: number[];
  numericValue?: number;
  matches?: MatchPair[];
  essayText?: string;
}

export function gradeObjectiveItem(
  question: BankLikeQuestion,
  answer: QuizAnswerLike | undefined,
): GradedItem {
  const maxScore = question.points;
  const empty: GradedItem = {
    questionId: question.id,
    questionType: question.questionType,
    score: 0,
    maxScore,
    correct: false,
    skillId: question.skillId,
  };
  if (!answer) return empty;

  let result: { score: number; correct: boolean };
  switch (question.questionType) {
    case 'mcq': {
      const idx =
        question.correctOptionIndex ??
        (typeof question.payload.correctOptionIndex === 'number'
          ? question.payload.correctOptionIndex
          : 0);
      result = gradeMcq(idx, answer.selectedOptionIndex, question.points);
      break;
    }
    case 'msq': {
      const key = Array.isArray(question.payload.correctOptionIndexes)
        ? (question.payload.correctOptionIndexes as number[])
        : [];
      const mode: MsqCreditMode =
        question.payload.partialCredit === true ? 'partial' : 'all_or_nothing';
      result = gradeMsq(key, answer.selectedOptionIndexes, question.points, mode);
      break;
    }
    case 'numeric': {
      result = gradeNumeric(
        Number(question.payload.correctValue),
        Number(question.payload.tolerance ?? 0),
        answer.numericValue,
        question.points,
      );
      break;
    }
    case 'match': {
      const pairs = Array.isArray(question.payload.pairs)
        ? (question.payload.pairs as MatchPair[])
        : [];
      result = gradeMatch(pairs, answer.matches, question.points);
      break;
    }
    case 'essay':
      return empty;
    default:
      result = { score: 0, correct: false };
  }
  return {
    questionId: question.id,
    questionType: question.questionType,
    score: result.score,
    maxScore,
    correct: result.correct,
    skillId: question.skillId,
  };
}

export function gradeObjectiveQuiz(
  questions: readonly BankLikeQuestion[],
  answers: readonly QuizAnswerLike[],
): { score: number; maxScore: number; results: GradedItem[]; pendingEssay: boolean } {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  let score = 0;
  let maxScore = 0;
  let pendingEssay = false;
  const results = questions.map((q) => {
    maxScore += q.points;
    if (q.questionType === 'essay') {
      pendingEssay = true;
      return {
        questionId: q.id,
        questionType: q.questionType,
        score: 0,
        maxScore: q.points,
        correct: false,
        skillId: q.skillId,
      };
    }
    const graded = gradeObjectiveItem(q, byId.get(q.id));
    score += graded.score;
    return graded;
  });
  return { score: round4(score), maxScore: round4(maxScore), results, pendingEssay };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return round4((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round4(values.reduce((s, v) => s + v, 0) / values.length);
}

/** Item difficulty = % of attempts that earned full marks (0–1). */
export function itemDifficulty(correctCount: number, attemptCount: number): number | null {
  if (attemptCount <= 0) return null;
  return round4(correctCount / attemptCount);
}

export interface QuizAnalytics {
  assignmentId: string;
  submissionCount: number;
  mean: number | null;
  median: number | null;
  items: Array<{
    questionId: string;
    prompt: string;
    questionType: QuestionType;
    difficulty: number | null;
    correctCount: number;
    attemptCount: number;
  }>;
  students: Array<{
    studentId: string;
    score: number | null;
    answered: number;
    total: number;
    completion: number;
  }>;
}
