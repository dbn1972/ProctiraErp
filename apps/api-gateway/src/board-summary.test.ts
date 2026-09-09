import { afterEach, describe, expect, it } from 'vitest';
import {
  clearBoardSummariesForTests,
  emptyBoardSummary,
  seedBoardSummaryForTests,
} from './insights-ui-plugin.js';

describe('G-809 board summary helpers', () => {
  afterEach(() => clearBoardSummariesForTests());

  it('returns empty summary shape for unknown boardId', () => {
    const empty = emptyBoardSummary('unknown');
    expect(empty.boardId).toBe('unknown');
    expect(empty.schools).toBe(0);
    expect(empty.enrolment).toBe(0);
    expect(empty.schoolsBreakdown).toEqual([]);
  });

  it('stores and clears seeded summaries', () => {
    seedBoardSummaryForTests({
      boardId: 'board-1',
      generatedAt: '2026-09-08T00:00:00.000Z',
      schools: 2,
      enrolment: 1000,
      attendancePercent: 94.5,
      feesCollectedCents: 2500000,
      lmsCompletionPercent: 81,
      schoolsBreakdown: [
        { institutionId: 's1', name: 'School A', enrolment: 500 },
        { institutionId: 's2', name: 'School B', enrolment: 500 },
      ],
    });
    clearBoardSummariesForTests();
    expect(emptyBoardSummary('board-1').schools).toBe(0);
  });
});
