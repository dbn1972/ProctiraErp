import { describe, expect, it } from 'vitest';

import {
  applyCreditRule,
  computeGpaSnapshot,
  resolveBandFromPercent,
  resolveGradePoints,
  type GradeBand,
} from './gpa-engine.js';

const CBSE_BANDS: GradeBand[] = [
  { label: 'A1', minPercent: 91, maxPercent: 100, gradePoints: 10 },
  { label: 'A2', minPercent: 81, maxPercent: 90.99, gradePoints: 9 },
  { label: 'B1', minPercent: 71, maxPercent: 80.99, gradePoints: 8 },
  { label: 'B2', minPercent: 61, maxPercent: 70.99, gradePoints: 7 },
  { label: 'C1', minPercent: 51, maxPercent: 60.99, gradePoints: 6 },
  { label: 'C2', minPercent: 41, maxPercent: 50.99, gradePoints: 5 },
  { label: 'D', minPercent: 33, maxPercent: 40.99, gradePoints: 4 },
  { label: 'E', minPercent: 0, maxPercent: 32.99, gradePoints: 0 },
];

describe('resolveBandFromPercent', () => {
  it('maps CBSE A1 / D / E', () => {
    expect(resolveBandFromPercent(95, CBSE_BANDS)?.label).toBe('A1');
    expect(resolveBandFromPercent(35, CBSE_BANDS)?.label).toBe('D');
    expect(resolveBandFromPercent(20, CBSE_BANDS)?.label).toBe('E');
  });
});

describe('resolveGradePoints', () => {
  it('prefers letter when provided', () => {
    const r = resolveGradePoints({ numericScore: 95, letterGrade: 'B1' }, CBSE_BANDS);
    expect(r.letterGrade).toBe('B1');
    expect(r.gradePoints).toBe(8);
  });

  it('derives from percent', () => {
    const r = resolveGradePoints({ numericScore: 85 }, CBSE_BANDS);
    expect(r.letterGrade).toBe('A2');
    expect(r.gradePoints).toBe(9);
  });
});

describe('applyCreditRule', () => {
  it('awards full credits on pass', () => {
    expect(
      applyCreditRule({ credits: 1 }, { numericScore: 40 }),
    ).toEqual({ creditsEarned: 1, completed: true });
  });

  it('awards zero on fail', () => {
    expect(
      applyCreditRule({ credits: 2, metadata: { minPercent: 33 } }, { numericScore: 20 }),
    ).toEqual({ creditsEarned: 0, completed: false });
  });

  it('supports partial credit hook', () => {
    const r = applyCreditRule(
      { credits: 4, metadata: { minPercent: 33, partialCredit: true } },
      { numericScore: 50 },
    );
    expect(r.completed).toBe(true);
    expect(r.creditsEarned).toBe(2);
  });
});

describe('computeGpaSnapshot', () => {
  it('computes weighted and unweighted GPA with credits', () => {
    const snap = computeGpaSnapshot(
      [
        { courseCode: 'MATH', numericScore: 95, credits: 1 },
        { courseCode: 'SCI', numericScore: 85, credits: 2 },
        { courseCode: 'ART', numericScore: 20, credits: 1 },
      ],
      CBSE_BANDS,
      { passingPercent: 33, weightMode: 'CREDITS', roundTo: 3 },
    );
    // Unweighted: (10 + 9 + 0) / 3 = 6.333
    expect(snap.unweightedGpa).toBe(6.333);
    // Weighted: (10*1 + 9*2 + 0*1) / (1+2+1) = 28/4 = 7
    expect(snap.weightedGpa).toBe(7);
    expect(snap.creditsEarned).toBe(3); // ART failed
    expect(snap.creditsAttempted).toBe(4);
  });

  it('honors board maxGradePoints cap', () => {
    const snap = computeGpaSnapshot(
      [{ courseCode: 'X', numericScore: 100, credits: 1 }],
      [{ label: 'A', minPercent: 0, maxPercent: 100, gradePoints: 12 }],
      { maxGradePoints: 10 },
    );
    expect(snap.courses[0]!.gradePoints).toBe(10);
  });

  it('excludes courses with includeInGpa=false from GPA', () => {
    const snap = computeGpaSnapshot(
      [
        { courseCode: 'CORE', numericScore: 95, credits: 1 },
        { courseCode: 'PE', numericScore: 100, credits: 1, includeInGpa: false },
      ],
      CBSE_BANDS,
    );
    expect(snap.unweightedGpa).toBe(10);
    expect(snap.creditsEarned).toBe(2);
  });
});
