/**
 * Property-based test for the Lighthouse budget gate (Task 55.8 / Property F-10).
 *
 * **Property F-10: Lighthouse Budget**
 *
 * *For any* production build of the dashboard shell route (`/`), the Lighthouse
 * audit on a simulated 3G network and low-end mobile CPU profile SHALL produce:
 *   Accessibility ≥ 95, Performance ≥ 80, Best Practices ≥ 90, SEO ≥ 90.
 *
 * This property test validates the `evaluateLhrAgainstThresholds` evaluator
 * against randomly generated Lighthouse report objects. It asserts:
 *   1. When ALL category scores meet or exceed their thresholds, the verdict
 *      is `passed=true`.
 *   2. When ANY category score falls below its threshold, the verdict is
 *      `passed=false`.
 *   3. The evaluator never produces a false positive (passes a report that
 *      should fail) or a false negative (fails a report that should pass).
 *
 * **Validates: Requirements 39.1, 39.2**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// @ts-expect-error - direct .mjs import; types are not generated.
import * as gate from '../check-lighthouse.mjs';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** The four Lighthouse category IDs that Property F-10 names. */
const CATEGORY_IDS = ['accessibility', 'performance', 'best-practices', 'seo'] as const;

/**
 * Generate a Lighthouse score in [0, 1] rounded to two decimal places
 * (matching Lighthouse's actual output precision).
 */
const scoreArb = fc.double({ min: 0, max: 1, noNaN: true }).map((v) => Math.round(v * 100) / 100);

/**
 * Generate a full set of category scores where every score is AT or ABOVE
 * its threshold (a passing report).
 */
const passingScoresArb = fc.record({
  accessibility: fc
    .double({ min: 0.95, max: 1, noNaN: true })
    .map((v) => Math.round(v * 100) / 100),
  performance: fc.double({ min: 0.8, max: 1, noNaN: true }).map((v) => Math.round(v * 100) / 100),
  'best-practices': fc
    .double({ min: 0.9, max: 1, noNaN: true })
    .map((v) => Math.round(v * 100) / 100),
  seo: fc.double({ min: 0.9, max: 1, noNaN: true }).map((v) => Math.round(v * 100) / 100),
});

/**
 * Generate a set of category scores where AT LEAST ONE score is strictly
 * below its threshold (a failing report).
 */
const failingScoresArb = fc
  .record({
    accessibility: scoreArb,
    performance: scoreArb,
    'best-practices': scoreArb,
    seo: scoreArb,
  })
  .filter((scores) => {
    // At least one category must be below its threshold
    return (
      scores.accessibility < 0.95 ||
      scores.performance < 0.8 ||
      scores['best-practices'] < 0.9 ||
      scores.seo < 0.9
    );
  });

/**
 * Build a minimal Lighthouse report object from a scores map.
 * The evaluator only reads `categories[<id>].score`.
 */
function buildLhr(scores: Record<string, number>) {
  const categories: Record<string, { score: number }> = {};
  for (const [id, score] of Object.entries(scores)) {
    categories[id] = { score };
  }
  return { categories };
}

// ---------------------------------------------------------------------------
// Property F-10: Lighthouse Budget
// ---------------------------------------------------------------------------

describe('Property F-10: Lighthouse Budget', () => {
  it('passes when all category scores meet or exceed their thresholds', () => {
    fc.assert(
      fc.property(passingScoresArb, (scores) => {
        const lhr = buildLhr(scores);
        const verdict = gate.evaluateLhrAgainstThresholds(lhr);

        // The overall verdict must be PASS
        expect(verdict.passed).toBe(true);

        // Each individual category must also report passed
        for (const categoryId of CATEGORY_IDS) {
          expect(verdict.scores[categoryId].passed).toBe(true);
          expect(verdict.scores[categoryId].score).toBeGreaterThanOrEqual(
            verdict.scores[categoryId].threshold,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it('fails when any category score falls below its threshold', () => {
    fc.assert(
      fc.property(failingScoresArb, (scores) => {
        const lhr = buildLhr(scores);
        const verdict = gate.evaluateLhrAgainstThresholds(lhr);

        // The overall verdict must be FAIL
        expect(verdict.passed).toBe(false);

        // At least one category must report failed
        const failedCategories = CATEGORY_IDS.filter((id) => !verdict.scores[id].passed);
        expect(failedCategories.length).toBeGreaterThan(0);

        // Every failed category must have a score below its threshold
        for (const id of failedCategories) {
          expect(verdict.scores[id].score).toBeLessThan(verdict.scores[id].threshold);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('the threshold boundary is exact: score === threshold passes, score < threshold fails', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CATEGORY_IDS),
        fc.double({ min: 0.001, max: 0.05, noNaN: true }),
        (categoryId, delta) => {
          const thresholds: Record<string, number> = { ...gate.SCORE_THRESHOLDS };
          const threshold = thresholds[categoryId];

          // Build a report where the chosen category is exactly at threshold
          const atThreshold: Record<string, number> = {};
          for (const id of CATEGORY_IDS) {
            atThreshold[id] = 1.0; // all others pass comfortably
          }
          atThreshold[categoryId] = threshold;

          const verdictAt = gate.evaluateLhrAgainstThresholds(buildLhr(atThreshold));
          expect(verdictAt.passed).toBe(true);
          expect(verdictAt.scores[categoryId].passed).toBe(true);

          // Build a report where the chosen category is just below threshold
          const belowThreshold = { ...atThreshold };
          const belowScore = Math.round((threshold - delta) * 100) / 100;
          // Only test if the below score is actually below the threshold
          if (belowScore < threshold) {
            belowThreshold[categoryId] = belowScore;
            const verdictBelow = gate.evaluateLhrAgainstThresholds(buildLhr(belowThreshold));
            expect(verdictBelow.passed).toBe(false);
            expect(verdictBelow.scores[categoryId].passed).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('handles malformed reports gracefully (never throws, always returns passed=false)', () => {
    const malformedLhrArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.constant({}),
      fc.constant({ categories: null }),
      fc.constant({ categories: undefined }),
      fc.constant({ categories: 'not-an-object' }),
      fc.constant({ categories: [] }),
      fc.constant({ categories: { accessibility: 'not-a-category-object' } }),
      fc.constant({ categories: { accessibility: { score: null } } }),
    );

    fc.assert(
      fc.property(malformedLhrArb, (lhr) => {
        // Must not throw
        const verdict = gate.evaluateLhrAgainstThresholds(lhr);
        // Must always fail for malformed input
        expect(verdict.passed).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  it('score thresholds match the values defined by Property F-10', () => {
    // This is a sanity check that the thresholds used by the evaluator
    // are exactly the ones specified in the design document.
    expect(gate.SCORE_THRESHOLDS).toEqual({
      accessibility: 0.95,
      performance: 0.8,
      'best-practices': 0.9,
      seo: 0.9,
    });
  });
});
