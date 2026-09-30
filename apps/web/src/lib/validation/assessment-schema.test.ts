/**
 * PRC-H114 — the grading scheme form rejects overlapping / gapped / partial bands with a
 * field error on the offending row, and accepts contiguous schemes.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findThresholdCoverageIssues, gradingSchemeFormSchema } from './assessment-schema';

function parse(thresholds: Array<{ grade: string; minScore: number; maxScore: number }>) {
  return gradingSchemeFormSchema.safeParse({
    name: 'Scheme',
    type: 'numeric',
    minValue: 0,
    maxValue: 100,
    thresholds,
  });
}

function fieldErrors(result: ReturnType<typeof parse>) {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

describe('gradingSchemeFormSchema threshold coverage (PRC-H114)', () => {
  it('accepts the default 2-dp template (C 0–59.99, B 60–79.99, A 80–100)', () => {
    expect(
      parse([
        { grade: 'A', minScore: 80, maxScore: 100 },
        { grade: 'B', minScore: 60, maxScore: 79.99 },
        { grade: 'C', minScore: 0, maxScore: 59.99 },
      ]).success,
    ).toBe(true);
  });

  it('rejects a gap with a field error on the band after the gap', () => {
    const errors = fieldErrors(
      parse([
        { grade: 'F', minScore: 0, maxScore: 49 },
        { grade: 'P', minScore: 51, maxScore: 100 },
      ]),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: 'thresholds.1.minScore',
        message: expect.stringMatching(/gap/i),
      }),
    );
  });

  it('rejects an overlap with a field error', () => {
    const errors = fieldErrors(
      parse([
        { grade: 'P', minScore: 60, maxScore: 100 },
        { grade: 'F', minScore: 0, maxScore: 60 },
      ]),
    );
    expect(errors).toContainEqual(
      expect.objectContaining({
        path: 'thresholds.0.minScore',
        message: expect.stringMatching(/overlap/i),
      }),
    );
  });

  it('rejects bands that do not cover the scheme minimum or maximum', () => {
    const errors = fieldErrors(parse([{ grade: 'A', minScore: 10, maxScore: 90 }]));
    expect(errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(['thresholds.0.minScore', 'thresholds.0.maxScore']),
    );
  });

  it('property: generated contiguous schemes are accepted; removing a band is rejected', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 2000 }), { minLength: 2, maxLength: 6 }),
        fc.nat(),
        (widths, drop) => {
          const thresholds: Array<{ minScore: number; maxScore: number }> = [];
          let cursor = 0;
          for (const width of widths) {
            thresholds.push({ minScore: cursor / 100, maxScore: (cursor + width) / 100 });
            cursor += width + 1; // next band starts 0.01 later
          }
          const maxValue = thresholds[thresholds.length - 1]!.maxScore;
          expect(findThresholdCoverageIssues(thresholds, 0, maxValue)).toEqual([]);
          // Dropping an inner band opens a gap wider than one mark only if it is > 1 wide;
          // dropping the first or last band always leaves the range uncovered.
          const index = drop % thresholds.length;
          const removed = thresholds[index]!;
          const rest = thresholds.filter((_, i) => i !== index);
          const inner = index > 0 && index < thresholds.length - 1;
          const width = removed.maxScore - removed.minScore + 0.02;
          if (!inner || width > 1 + 1e-9) {
            expect(findThresholdCoverageIssues(rest, 0, maxValue).length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
