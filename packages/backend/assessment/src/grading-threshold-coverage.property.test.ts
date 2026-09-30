/**
 * PRC-H114 — grading scheme bands must cover [minValue, maxValue] with no overlap and
 * no skipped mark; every score in range then maps to exactly one grade.
 */
import { BusinessRuleError } from '@proctira/common';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssessmentService } from './assessment-service.js';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { assignGradeForScore } from './result-service.js';

const tenantId = 'tenant-h114';

describe('grading threshold coverage (PRC-H114)', () => {
  let schemes: InMemoryGradingSchemeRepository;
  let service: AssessmentService;

  beforeEach(() => {
    schemes = new InMemoryGradingSchemeRepository();
    service = new AssessmentService(
      schemes,
      new InMemoryAssessmentItemRepository(),
      new InMemoryOutcomeRepository(),
    );
  });

  const create = (thresholds: Array<{ grade: string; minScore: number; maxScore: number }>) =>
    service.createGradingScheme(tenantId, {
      name: `S-${Math.random()}`,
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds,
    });

  it('rejects a gap that skips a mark (0–49 / 51–100 leaves 50 ungraded)', async () => {
    await expect(
      create([
        { grade: 'F', minScore: 0, maxScore: 49 },
        { grade: 'P', minScore: 51, maxScore: 100 },
      ]),
    ).rejects.toThrow(/gap/);
  });

  it('rejects overlapping bands', async () => {
    await expect(
      create([
        { grade: 'F', minScore: 0, maxScore: 60 },
        { grade: 'P', minScore: 60, maxScore: 100 },
      ]),
    ).rejects.toThrow(/overlap/);
  });

  it('rejects bands that do not reach the scheme minimum or maximum', async () => {
    await expect(create([{ grade: 'A', minScore: 90, maxScore: 100 }])).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    await expect(create([{ grade: 'A', minScore: 0, maxScore: 99 }])).rejects.toThrow(/maximum/);
  });

  it('accepts the default 2-dp template and whole-mark bands', async () => {
    await expect(
      create([
        { grade: 'A', minScore: 80, maxScore: 100 },
        { grade: 'B', minScore: 60, maxScore: 79.99 },
        { grade: 'C', minScore: 0, maxScore: 59.99 },
      ]),
    ).resolves.toBeTruthy();
    await expect(
      create([
        { grade: 'A', minScore: 90, maxScore: 100 },
        { grade: 'B', minScore: 80, maxScore: 89 },
        { grade: 'F', minScore: 0, maxScore: 79 },
      ]),
    ).resolves.toBeTruthy();
  });

  it('allows a rename-only update of a legacy scheme with incomplete bands', async () => {
    await schemes.create({
      id: 'legacy-1',
      tenantId,
      name: 'Legacy',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
    });
    await expect(
      service.updateGradingScheme(tenantId, 'legacy-1', { name: 'Legacy (renamed)' }),
    ).resolves.toBeTruthy();
    await expect(
      service.updateGradingScheme(tenantId, 'legacy-1', {
        thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
      }),
    ).rejects.toThrow(/minimum/);
  });

  it('grades an unrounded score between 2-dp bands (79.995 → B, not Ungraded)', () => {
    const thresholds = [
      { grade: 'A', minScore: 80, maxScore: 100 },
      { grade: 'B', minScore: 60, maxScore: 79.99 },
      { grade: 'C', minScore: 0, maxScore: 59.99 },
    ];
    expect(assignGradeForScore(79.995, thresholds).grade).toBe('B');
    expect(assignGradeForScore(80, thresholds).grade).toBe('A');
    expect(assignGradeForScore(100.01, thresholds).grade).toBe('Ungraded');
  });

  it('property: every value in range of an accepted scheme maps to exactly one grade', async () => {
    // Random band boundaries on a 2-dp grid; each next band starts 0.01..1 after the
    // previous one ends (the widest gap the validator accepts).
    const schemeArb = fc
      .array(fc.integer({ min: 1, max: 3000 }), { minLength: 1, maxLength: 5 })
      .chain((widths) =>
        fc
          .array(fc.integer({ min: 1, max: 100 }), {
            minLength: widths.length,
            maxLength: widths.length,
          })
          .map((gaps) => {
            const thresholds: Array<{ grade: string; minScore: number; maxScore: number }> = [];
            let cursor = 0; // hundredths
            widths.forEach((width, i) => {
              const min = cursor;
              const max = min + width;
              thresholds.push({ grade: `G${i}`, minScore: min / 100, maxScore: max / 100 });
              cursor = max + gaps[i]!;
            });
            const maxValue = thresholds[thresholds.length - 1]!.maxScore;
            return { thresholds, maxValue };
          }),
      );
    await fc.assert(
      fc.asyncProperty(schemeArb, fc.double({ min: 0, max: 1, noNaN: true }), async (s, t) => {
        const scheme = await service.createGradingScheme(tenantId, {
          name: `P-${Math.random()}`,
          type: 'numeric',
          minValue: 0,
          maxValue: s.maxValue,
          thresholds: s.thresholds,
        });
        const score = t * s.maxValue;
        const { grade } = assignGradeForScore(score, scheme.thresholds);
        expect(grade).not.toBe('Ungraded');
        // Exactly one band claims the score under half-open semantics.
        const sortedMins = scheme.thresholds.map((b) => b.minScore).sort((a, b) => a - b);
        const claimed = sortedMins.filter(
          (min, i) => score >= min && (i === sortedMins.length - 1 || score < sortedMins[i + 1]!),
        );
        expect(claimed).toHaveLength(1);
      }),
      { numRuns: 200 },
    );
  });
});
