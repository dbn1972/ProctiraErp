/**
 * Property Test: Score Validation and Grade Calculation (Property 19)
 *
 * Validates: Requirements 8.4, 8.5
 *
 * Property: For any assessment result entry, the score SHALL fall within the
 * grading scheme's defined minimum and maximum range. For any set of valid
 * scores with defined weights, the weighted average SHALL be calculated
 * correctly and the corresponding grade SHALL be assigned based on configured
 * thresholds.
 *
 * Tests:
 * 1. Any score within the assessment item's defined min/max range is accepted
 * 2. Any score outside the range is rejected with an error message indicating the valid range
 * 3. Weighted averages are correctly calculated from individual item scores
 * 4. Grades are correctly assigned based on threshold boundaries
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { BusinessRuleError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import { ResultService } from './result-service.js';
import { AssessmentService } from './assessment-service.js';
import {
  InMemoryGradingSchemeRepository,
  InMemoryAssessmentItemRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import type { GradingSchemeEntity, AssessmentItemEntity } from './assessment-repository.js';

describe('Score Validation and Grade Calculation', () => {
  // Feature: proctira-unified-platform, Property 19: Score Validation and Grade Calculation
  // **Validates: Requirements 8.4, 8.5**

  let resultService: ResultService;
  let assessmentService: AssessmentService;
  let gradingSchemeRepo: InMemoryGradingSchemeRepository;
  let assessmentItemRepo: InMemoryAssessmentItemRepository;
  let outcomeRepo: InMemoryOutcomeRepository;
  let resultRepo: InMemoryAssessmentResultRepository;

  const tenantId = 'tenant-pbt-019';
  const subjectId = '11111111-1111-4111-8111-111111111111';
  const academicPeriodId = '22222222-2222-4222-8222-222222222222';
  const studentId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    gradingSchemeRepo = new InMemoryGradingSchemeRepository();
    assessmentItemRepo = new InMemoryAssessmentItemRepository();
    outcomeRepo = new InMemoryOutcomeRepository();
    resultRepo = new InMemoryAssessmentResultRepository();
    assessmentService = new AssessmentService(gradingSchemeRepo, assessmentItemRepo, outcomeRepo);
    resultService = new ResultService(resultRepo, assessmentItemRepo, gradingSchemeRepo);
  });

  /**
   * Helper: Generate a valid grading scheme with arbitrary min/max values.
   * Ensures minValue < maxValue and thresholds cover the range without overlap.
   */
  function gradingSchemeArbitrary() {
    return fc
      .record({
        minValue: fc.integer({ min: 0, max: 49 }),
        maxValue: fc.integer({ min: 51, max: 200 }),
      })
      .filter(({ minValue, maxValue }) => minValue < maxValue)
      .chain(({ minValue, maxValue }) => {
        // Generate 2-5 non-overlapping thresholds covering the range
        const range = maxValue - minValue;
        return fc.integer({ min: 2, max: Math.min(5, range) }).chain((numThresholds) => {
          // Generate split points to divide the range into non-overlapping thresholds
          // Each threshold gets at least 1 unit of range
          return fc
            .array(fc.integer({ min: 1, max: range }), {
              minLength: numThresholds,
              maxLength: numThresholds,
            })
            .map((rawSplits) => {
              // Normalize splits to sum to range
              const rawSum = rawSplits.reduce((s, v) => s + v, 0);
              let allocated = rawSplits.map((v) => Math.max(1, Math.floor((v / rawSum) * range)));
              let currentSum = allocated.reduce((s, v) => s + v, 0);
              let diff = range - currentSum;
              let idx = 0;
              while (diff > 0) {
                allocated[idx % numThresholds]!++;
                diff--;
                idx++;
              }
              while (diff < 0) {
                const target = allocated.findIndex((v) => v > 1);
                if (target >= 0) {
                  allocated[target]!--;
                }
                diff++;
              }

              // Build thresholds from allocated sizes
              const grades = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, numThresholds);
              const thresholds: Array<{ grade: string; minScore: number; maxScore: number }> = [];
              let cursor = minValue;
              // Build from lowest to highest
              for (let i = numThresholds - 1; i >= 0; i--) {
                const size = allocated[i]!;
                thresholds.push({
                  grade: grades[i]!,
                  minScore: cursor,
                  maxScore: cursor + size - 1,
                });
                cursor += size;
              }

              return { minValue, maxValue, thresholds };
            });
        });
      });
  }

  /**
   * Helper: Generate assessment items with weights summing to 100% and
   * score ranges within the grading scheme bounds.
   */
  function assessmentItemsArbitrary(minScore: number, maxScore: number) {
    return fc.integer({ min: 1, max: 5 }).chain((count) => {
      // Generate weights summing to 100 (in cents for precision)
      return fc
        .array(fc.integer({ min: 1, max: 10000 }), {
          minLength: count,
          maxLength: count,
        })
        .map((rawWeights) => {
          const rawSum = rawWeights.reduce((s, v) => s + v, 0);
          let allocated = rawWeights.map((v) => Math.max(1, Math.floor((v / rawSum) * 10000)));
          let currentSum = allocated.reduce((s, v) => s + v, 0);
          let diff = 10000 - currentSum;
          let idx = 0;
          while (diff > 0) {
            allocated[idx % count]!++;
            diff--;
            idx++;
          }
          while (diff < 0) {
            const target = allocated.findIndex((v) => v > 1);
            if (target >= 0) {
              allocated[target]!--;
            }
            diff++;
          }

          return allocated.map((cents, i) => ({
            name: `Item ${i + 1}`,
            weight: cents / 100,
            minScore,
            maxScore,
          }));
        });
    });
  }

  it('should accept any score within the assessment item defined min/max range', async () => {
    await fc.assert(
      fc.asyncProperty(
        gradingSchemeArbitrary(),
        fc.integer({ min: 1, max: 5 }),
        async (schemeConfig, itemCount) => {
          // Create grading scheme
          const scheme = await assessmentService.createGradingScheme(tenantId, {
            name: `Scheme-${uuidv4()}`,
            type: 'numeric',
            minValue: schemeConfig.minValue,
            maxValue: schemeConfig.maxValue,
            thresholds: schemeConfig.thresholds,
          });

          // Create assessment items with weights summing to 100%
          const baseCents = Math.floor(10000 / itemCount);
          const remainder = 10000 - baseCents * itemCount;
          const weights = Array.from({ length: itemCount }, (_, i) => {
            const cents = baseCents + (i < remainder ? 1 : 0);
            return cents / 100;
          });

          const items = weights.map((weight, i) => ({
            name: `Item ${i + 1}`,
            weight,
            minScore: schemeConfig.minValue,
            maxScore: schemeConfig.maxValue,
          }));

          const createdItems = await assessmentService.defineAssessmentItems(tenantId, {
            subjectId,
            academicPeriodId,
            gradingSchemeId: scheme.id,
            items,
          });

          // For each item, generate a score within the valid range and verify it's accepted
          for (const item of createdItems) {
            const validScore =
              schemeConfig.minValue +
              Math.floor(Math.random() * (schemeConfig.maxValue - schemeConfig.minValue + 1));

            const result = await resultService.enterSingleResult(tenantId, {
              studentId,
              assessmentItemId: item.id,
              subjectId,
              academicPeriodId,
              score: validScore,
            });

            expect(result).toBeDefined();
            expect(result.score).toBe(validScore);
            expect(result.studentId).toBe(studentId);
            expect(result.assessmentItemId).toBe(item.id);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('should reject any score outside the assessment item defined min/max range with error indicating valid range', async () => {
    await fc.assert(
      fc.asyncProperty(
        gradingSchemeArbitrary(),
        fc.boolean(), // true = above max, false = below min
        fc.integer({ min: 1, max: 100 }), // offset from boundary
        async (schemeConfig, aboveMax, offset) => {
          // Create grading scheme
          const scheme = await assessmentService.createGradingScheme(tenantId, {
            name: `Scheme-${uuidv4()}`,
            type: 'numeric',
            minValue: schemeConfig.minValue,
            maxValue: schemeConfig.maxValue,
            thresholds: schemeConfig.thresholds,
          });

          // Create a single assessment item
          const createdItems = await assessmentService.defineAssessmentItems(tenantId, {
            subjectId,
            academicPeriodId,
            gradingSchemeId: scheme.id,
            items: [
              {
                name: 'Test Item',
                weight: 100,
                minScore: schemeConfig.minValue,
                maxScore: schemeConfig.maxValue,
              },
            ],
          });

          const item = createdItems[0]!;

          // Generate an invalid score (outside the range)
          const invalidScore = aboveMax
            ? schemeConfig.maxValue + offset
            : schemeConfig.minValue - offset;

          try {
            await resultService.enterSingleResult(tenantId, {
              studentId,
              assessmentItemId: item.id,
              subjectId,
              academicPeriodId,
              score: invalidScore,
            });
            // Should not reach here
            throw new Error('Expected BusinessRuleError but call succeeded');
          } catch (error) {
            if (!(error instanceof BusinessRuleError)) {
              throw error;
            }
            // Error message must indicate the valid range
            expect(error.message).toContain(String(schemeConfig.minValue));
            expect(error.message).toContain(String(schemeConfig.maxValue));
            expect(error.message).toContain(String(invalidScore));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should correctly calculate weighted averages from individual item scores', async () => {
    await fc.assert(
      fc.asyncProperty(
        gradingSchemeArbitrary(),
        fc.integer({ min: 2, max: 5 }),
        async (schemeConfig, itemCount) => {
          // Create grading scheme
          const scheme = await assessmentService.createGradingScheme(tenantId, {
            name: `Scheme-${uuidv4()}`,
            type: 'numeric',
            minValue: schemeConfig.minValue,
            maxValue: schemeConfig.maxValue,
            thresholds: schemeConfig.thresholds,
          });

          // Create assessment items with weights summing to 100%
          const baseCents = Math.floor(10000 / itemCount);
          const remainder = 10000 - baseCents * itemCount;
          const weights = Array.from({ length: itemCount }, (_, i) => {
            const cents = baseCents + (i < remainder ? 1 : 0);
            return cents / 100;
          });

          const items = weights.map((weight, i) => ({
            name: `Item ${i + 1}`,
            weight,
            minScore: schemeConfig.minValue,
            maxScore: schemeConfig.maxValue,
          }));

          const createdItems = await assessmentService.defineAssessmentItems(tenantId, {
            subjectId,
            academicPeriodId,
            gradingSchemeId: scheme.id,
            items,
          });

          // Enter scores for each item (random valid scores)
          const scores: number[] = [];
          for (const item of createdItems) {
            const score =
              schemeConfig.minValue +
              Math.floor(Math.random() * (schemeConfig.maxValue - schemeConfig.minValue + 1));
            scores.push(score);

            await resultService.enterSingleResult(tenantId, {
              studentId,
              assessmentItemId: item.id,
              subjectId,
              academicPeriodId,
              score,
            });
          }

          // Calculate grade
          const result = await resultService.calculateStudentGrade(
            tenantId,
            studentId,
            subjectId,
            academicPeriodId,
          );

          // Manually compute expected weighted average
          const range = schemeConfig.maxValue - schemeConfig.minValue;
          let expectedWeightedTotal = 0;
          for (let i = 0; i < createdItems.length; i++) {
            const normalizedScore = ((scores[i]! - schemeConfig.minValue) / range) * 100;
            const weightedScore = (normalizedScore * createdItems[i]!.weight) / 100;
            expectedWeightedTotal += weightedScore;
          }
          const expectedAverage = schemeConfig.minValue + (expectedWeightedTotal / 100) * range;
          const roundedExpected = Math.round(expectedAverage * 100) / 100;

          // Verify weighted average matches
          expect(result.weightedAverage).toBe(roundedExpected);
          // Verify all item scores are present
          expect(result.itemScores).toHaveLength(createdItems.length);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('should correctly assign grades based on threshold boundaries', async () => {
    await fc.assert(
      fc.asyncProperty(gradingSchemeArbitrary(), async (schemeConfig) => {
        // Create grading scheme
        const scheme = await assessmentService.createGradingScheme(tenantId, {
          name: `Scheme-${uuidv4()}`,
          type: 'numeric',
          minValue: schemeConfig.minValue,
          maxValue: schemeConfig.maxValue,
          thresholds: schemeConfig.thresholds,
        });

        // Create a single assessment item covering the full range
        const createdItems = await assessmentService.defineAssessmentItems(tenantId, {
          subjectId,
          academicPeriodId,
          gradingSchemeId: scheme.id,
          items: [
            {
              name: 'Full Range Item',
              weight: 100,
              minScore: schemeConfig.minValue,
              maxScore: schemeConfig.maxValue,
            },
          ],
        });

        const item = createdItems[0]!;

        // For each threshold, pick a score within that threshold's range
        // and verify the correct grade is assigned
        for (const threshold of schemeConfig.thresholds) {
          // Pick the midpoint of the threshold range
          const score = Math.floor((threshold.minScore + threshold.maxScore) / 2);

          // Clear previous results
          resultRepo.clear();

          await resultService.enterSingleResult(tenantId, {
            studentId,
            assessmentItemId: item.id,
            subjectId,
            academicPeriodId,
            score,
          });

          const result = await resultService.calculateStudentGrade(
            tenantId,
            studentId,
            subjectId,
            academicPeriodId,
          );

          // With a single item at weight 100% and minScore/maxScore matching the scheme,
          // the weighted average equals the score itself.
          // The normalized score = ((score - min) / (max - min)) * 100
          // The weighted average = min + (normalizedScore / 100) * (max - min) = score
          expect(result.weightedAverage).toBe(score);

          // Verify the grade matches the threshold that contains this score
          // Find which threshold the weighted average falls into
          const matchingThreshold = schemeConfig.thresholds.find(
            (t) => result.weightedAverage >= t.minScore && result.weightedAverage <= t.maxScore,
          );

          if (matchingThreshold) {
            expect(result.grade).toBe(matchingThreshold.grade);
          } else {
            // If no threshold matches (score falls in a gap), grade should be 'Ungraded'
            expect(result.grade).toBe('Ungraded');
          }
        }
      }),
      { numRuns: 50 },
    );
  });
});
