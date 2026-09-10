/**
 * Property Test: Assessment Weight Sum Constraint (Property 18)
 *
 * Validates: Requirements 8.2, 8.3
 *
 * Property: For any set of assessment items defined for a subject within an
 * academic period, the percentage weights SHALL sum to exactly 100%. If they
 * do not, the configuration SHALL be rejected with an error indicating the
 * current total and difference from 100%.
 *
 * Tests:
 * 1. Any valid set of items with weights summing to exactly 100% is accepted
 * 2. Any set of items with weights NOT summing to 100% is rejected with
 *    appropriate error message showing current total and difference
 * 3. Up to 50 items per subject per academic period are allowed
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { BusinessRuleError } from '@proctira/common';

import { AssessmentService } from './assessment-service.js';
import {
  InMemoryGradingSchemeRepository,
  InMemoryAssessmentItemRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';

describe('Assessment Weight Sum Constraint', () => {
  // Feature: proctira-unified-platform, Property 18: Assessment Weight Sum Constraint
  // **Validates: Requirements 8.2, 8.3**

  let service: AssessmentService;
  let gradingSchemeRepo: InMemoryGradingSchemeRepository;
  let assessmentItemRepo: InMemoryAssessmentItemRepository;
  let outcomeRepo: InMemoryOutcomeRepository;
  let gradingSchemeId: string;

  const tenantId = 'tenant-pbt-001';
  const subjectId = '11111111-1111-4111-8111-111111111111';
  const academicPeriodId = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    gradingSchemeRepo = new InMemoryGradingSchemeRepository();
    assessmentItemRepo = new InMemoryAssessmentItemRepository();
    outcomeRepo = new InMemoryOutcomeRepository();
    service = new AssessmentService(gradingSchemeRepo, assessmentItemRepo, outcomeRepo);

    // Create a valid grading scheme for all tests
    const scheme = await service.createGradingScheme(tenantId, {
      name: 'PBT Test Scale',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [
        { grade: 'A', minScore: 90, maxScore: 100 },
        { grade: 'B', minScore: 80, maxScore: 89 },
        { grade: 'C', minScore: 70, maxScore: 79 },
        { grade: 'F', minScore: 0, maxScore: 69 },
      ],
    });
    gradingSchemeId = scheme.id;
  });

  /**
   * Helper: Generate an arbitrary for N weights that sum to exactly 100.
   * Uses integer cents (hundredths) to avoid floating point issues.
   * Distributes 10000 cents among N items, each getting at least 1 cent (0.01%).
   */
  function weightsArbitrarySummingTo100(minItems: number, maxItems: number) {
    return fc.integer({ min: minItems, max: maxItems }).chain((count) => {
      // Generate (count - 1) unique, sorted split points in [1, 10000-1]
      // to divide 10000 cents into count parts, each at least 1 cent.
      // We use a "stars and bars" approach: generate count positive integers summing to 10000.
      // Strategy: generate count random integers >= 1, then scale to sum to 10000.
      return fc
        .array(fc.integer({ min: 1, max: 10000 }), {
          minLength: count,
          maxLength: count,
        })
        .map((rawValues) => {
          // Normalize to sum to 10000 cents, ensuring each part >= 1
          const rawSum = rawValues.reduce((s, v) => s + v, 0);
          // Allocate proportionally, rounding down
          let allocated = rawValues.map((v) => Math.max(1, Math.floor((v / rawSum) * 10000)));
          // Fix the sum to be exactly 10000
          let currentSum = allocated.reduce((s, v) => s + v, 0);
          let diff = 10000 - currentSum;
          // Distribute remaining cents to the largest items
          let idx = 0;
          while (diff > 0) {
            allocated[idx % count]!++;
            allocated = [...allocated]; // ensure mutation is captured
            diff--;
            idx++;
          }
          while (diff < 0) {
            // Find an item > 1 to subtract from
            const target = allocated.findIndex((v) => v > 1);
            if (target >= 0) {
              allocated[target]--;
              allocated = [...allocated];
            }
            diff++;
          }
          // Convert cents to decimal percentages
          return allocated.map((cents) => cents / 100);
        });
    });
  }

  /**
   * Helper: Generate weights that do NOT sum to 100.
   * Generates random weights and filters out those that happen to sum to 100.
   */
  function weightsArbitraryNotSummingTo100(minItems: number, maxItems: number) {
    return fc
      .array(
        fc.integer({ min: 1, max: 9999 }).map((v) => v / 100), // 0.01 to 99.99
        { minLength: minItems, maxLength: maxItems },
      )
      .filter((weights) => {
        const total = Math.round(weights.reduce((sum, w) => sum + w, 0) * 100) / 100;
        return total !== 100;
      });
  }

  it('should accept assessment items whose weights sum to exactly 100%', async () => {
    await fc.assert(
      fc.asyncProperty(weightsArbitrarySummingTo100(1, 50), async (weights) => {
        const items = weights.map((weight, i) => ({
          name: `Item ${i + 1}`,
          weight,
          minScore: 0,
          maxScore: 100,
        }));

        const input = {
          subjectId,
          academicPeriodId,
          gradingSchemeId,
          items,
        };

        const result = await service.defineAssessmentItems(tenantId, input);
        // Should succeed and return the correct number of items
        expect(result).toHaveLength(items.length);
      }),
      { numRuns: 100 },
    );
  });

  it('should reject assessment items whose weights do not sum to 100%', async () => {
    await fc.assert(
      fc.asyncProperty(weightsArbitraryNotSummingTo100(1, 50), async (weights) => {
        const items = weights.map((weight, i) => ({
          name: `Item ${i + 1}`,
          weight,
          minScore: 0,
          maxScore: 100,
        }));

        const input = {
          subjectId,
          academicPeriodId,
          gradingSchemeId,
          items,
        };

        try {
          await service.defineAssessmentItems(tenantId, input);
          // Should not reach here - must be rejected
          throw new Error('Expected BusinessRuleError but call succeeded');
        } catch (error) {
          if (!(error instanceof BusinessRuleError)) {
            throw error;
          }
          const message = error.message;
          // Error message must indicate 100% requirement
          expect(message).toContain('100%');
          // The message should contain the current total
          const roundedTotal = Math.round(weights.reduce((sum, w) => sum + w, 0) * 100) / 100;
          expect(message).toContain(String(roundedTotal));
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should allow up to 50 items per subject per academic period when weights sum to 100%', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50 }), async (itemCount) => {
        // Create items with equal weights summing to 100
        // Use integer arithmetic to avoid floating point issues
        const baseCents = Math.floor(10000 / itemCount);
        const remainder = 10000 - baseCents * itemCount;

        const weights: number[] = Array.from({ length: itemCount }, (_, i) => {
          // Distribute remainder across first N items
          const cents = baseCents + (i < remainder ? 1 : 0);
          return cents / 100;
        });

        const items = weights.map((weight, i) => ({
          name: `Item ${i + 1}`,
          weight,
          minScore: 0,
          maxScore: 100,
        }));

        const input = {
          subjectId,
          academicPeriodId,
          gradingSchemeId,
          items,
        };

        const result = await service.defineAssessmentItems(tenantId, input);
        expect(result).toHaveLength(itemCount);
      }),
      { numRuns: 50 },
    );
  });

  it('should reject more than 50 items per subject per academic period', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 51, max: 100 }), async (itemCount) => {
        // Create items (weights don't matter since count check happens first)
        const items = Array.from({ length: itemCount }, (_, i) => ({
          name: `Item ${i + 1}`,
          weight: 100 / itemCount,
          minScore: 0,
          maxScore: 100,
        }));

        const input = {
          subjectId,
          academicPeriodId,
          gradingSchemeId,
          items,
        };

        try {
          await service.defineAssessmentItems(tenantId, input);
          throw new Error('Expected BusinessRuleError but call succeeded');
        } catch (error) {
          if (!(error instanceof BusinessRuleError)) {
            throw error;
          }
          const message = error.message;
          // Error message must mention the 50 item limit
          expect(message).toContain('50');
        }
      }),
      { numRuns: 50 },
    );
  });
});
