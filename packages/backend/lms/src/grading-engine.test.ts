/**
 * LMS depth grading rules — MSQ, numeric, match, essay rubric, item difficulty.
 */
import { describe, expect, it } from 'vitest';

import {
  gradeEssay,
  gradeMatch,
  gradeMcq,
  gradeMsq,
  gradeNumeric,
  gradeObjectiveQuiz,
  itemDifficulty,
  mean,
  median,
  rubricTotal,
  type BankLikeQuestion,
} from './grading-engine.js';

function q(
  partial: Partial<BankLikeQuestion> & Pick<BankLikeQuestion, 'id' | 'questionType'>,
): BankLikeQuestion {
  return {
    points: 1,
    skillId: null,
    correctOptionIndex: -1,
    payload: {},
    ...partial,
  };
}

describe('gradeMcq', () => {
  it('awards full marks only for the keyed option', () => {
    expect(gradeMcq(1, 1, 2)).toEqual({ score: 2, correct: true });
    expect(gradeMcq(1, 0, 2)).toEqual({ score: 0, correct: false });
  });
});

describe('gradeMsq', () => {
  it('requires the exact set in all-or-nothing mode', () => {
    expect(gradeMsq([0, 2], [2, 0], 4)).toEqual({ score: 4, correct: true });
    expect(gradeMsq([0, 2], [0], 4)).toEqual({ score: 0, correct: false });
    expect(gradeMsq([0, 2], [0, 1, 2], 4)).toEqual({ score: 0, correct: false });
  });

  it('awards partial credit when enabled', () => {
    expect(gradeMsq([0, 2], [0], 4, 'partial').score).toBe(2);
    expect(gradeMsq([0, 2], [0, 1], 4, 'partial').score).toBe(0);
    expect(gradeMsq([0, 2], [0, 2], 4, 'partial')).toEqual({ score: 4, correct: true });
  });
});

describe('gradeNumeric', () => {
  it('accepts answers within absolute tolerance', () => {
    expect(gradeNumeric(3.14, 0.05, 3.1, 1)).toEqual({ score: 1, correct: true });
    expect(gradeNumeric(3.14, 0.05, 3.3, 1)).toEqual({ score: 0, correct: false });
  });
});

describe('gradeMatch', () => {
  it('scores per left/right pair', () => {
    const key = [
      { leftIndex: 0, rightIndex: 1 },
      { leftIndex: 1, rightIndex: 0 },
    ];
    expect(
      gradeMatch(key, [
        { leftIndex: 1, rightIndex: 0 },
        { leftIndex: 0, rightIndex: 1 },
      ]),
    ).toEqual({ score: 1, correct: true });
    expect(gradeMatch(key, [{ leftIndex: 0, rightIndex: 0 }], 2).score).toBe(0);
    expect(gradeMatch(key, [{ leftIndex: 0, rightIndex: 1 }], 2).score).toBe(1);
  });
});

describe('gradeEssay / rubricTotal', () => {
  it('sums criterion points capped at max', () => {
    expect(
      rubricTotal([
        { criterionId: 'a', points: 2, maxPoints: 4 },
        { criterionId: 'b', points: 3.5, maxPoints: 4 },
      ]),
    ).toEqual({ score: 5.5, maxScore: 8 });
  });

  it('scales essay marks from the rubric total', () => {
    const result = gradeEssay(
      [
        { criterionId: 'a', points: 4, maxPoints: 4 },
        { criterionId: 'b', points: 4, maxPoints: 4 },
      ],
      8,
    );
    expect(result.score).toBe(8);
    expect(result.correct).toBe(true);
  });
});

describe('gradeObjectiveQuiz', () => {
  it('scores MCQ like the Wave 8 engine', () => {
    const questions = [
      q({
        id: 'a',
        questionType: 'mcq',
        points: 2,
        correctOptionIndex: 1,
        payload: { correctOptionIndex: 1 },
      }),
    ];
    const ok = gradeObjectiveQuiz(questions, [{ questionId: 'a', selectedOptionIndex: 1 }]);
    expect(ok).toMatchObject({ score: 2, maxScore: 2, pendingEssay: false });
    const miss = gradeObjectiveQuiz(questions, [{ questionId: 'a', selectedOptionIndex: 0 }]);
    expect(miss.results[0]?.correct).toBe(false);
    expect(miss.score).toBe(0);
  });

  it('leaves essay items pending and still totals objective marks', () => {
    const questions = [
      q({
        id: 'mcq',
        questionType: 'mcq',
        points: 3,
        payload: { correctOptionIndex: 0 },
        correctOptionIndex: 0,
      }),
      q({ id: 'essay', questionType: 'essay', points: 5 }),
    ];
    const graded = gradeObjectiveQuiz(questions, [
      { questionId: 'mcq', selectedOptionIndex: 0 },
      { questionId: 'essay', essayText: 'because' },
    ]);
    expect(graded.pendingEssay).toBe(true);
    expect(graded.score).toBe(3);
    expect(graded.results[1]).toMatchObject({ score: 0, maxScore: 5, correct: false });
  });
});

describe('analytics helpers', () => {
  it('computes mean, median, and item difficulty as percent correct', () => {
    expect(mean([10, 20, 30])).toBe(20);
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(itemDifficulty(8, 10)).toBe(0.8);
    expect(itemDifficulty(0, 0)).toBeNull();
  });
});
