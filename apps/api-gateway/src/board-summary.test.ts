/**
 * Unit tests for G-809 board summary helpers (memory path).
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearBoardSummariesForTests,
  emptyBoardSummary,
  getBoardSummary,
  seedBoardSummaryForTests,
} from './board-summary.js';

describe('board-summary (memory)', () => {
  afterEach(() => {
    clearBoardSummariesForTests();
  });

  it('emptyBoardSummary returns the zero shape', () => {
    const s = emptyBoardSummary('b1', '2026-01-01T00:00:00.000Z');
    expect(s).toEqual({
      boardId: 'b1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      schools: 0,
      enrolment: 0,
      attendancePercent: null,
      feesCollectedCents: 0,
      lmsCompletionPercent: null,
      schoolsBreakdown: [],
    });
  });

  it('seedBoardSummaryForTests is returned by getBoardSummary in forceMemory', async () => {
    seedBoardSummaryForTests('board-seed', {
      schools: 2,
      enrolment: 99,
      feesCollectedCents: 500,
    });
    const summary = await getBoardSummary('board-seed', 'tenant-x', { forceMemory: true });
    expect(summary.schools).toBe(2);
    expect(summary.enrolment).toBe(99);
    expect(summary.feesCollectedCents).toBe(500);
  });

  it('unknown board returns zeros', async () => {
    const summary = await getBoardSummary('missing', 'tenant-x', { forceMemory: true });
    expect(summary.boardId).toBe('missing');
    expect(summary.schools).toBe(0);
    expect(summary.schoolsBreakdown).toEqual([]);
  });
});
