/**
 * Unit tests for AssessmentService
 *
 * Tests grading scheme CRUD, assessment item weight validation,
 * item count limits, and outcome-based mapping.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.6
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BusinessRuleError, ValidationError } from '@proctira/common';

import {
  AssessmentService,
  MAX_ITEMS_PER_SUBJECT_PERIOD,
  REQUIRED_WEIGHT_TOTAL,
} from './assessment-service.js';
import {
  InMemoryGradingSchemeRepository,
  InMemoryAssessmentItemRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';

describe('AssessmentService', () => {
  let service: AssessmentService;
  let gradingSchemeRepo: InMemoryGradingSchemeRepository;
  let assessmentItemRepo: InMemoryAssessmentItemRepository;
  let outcomeRepo: InMemoryOutcomeRepository;

  const tenantId = 'tenant-001';

  beforeEach(() => {
    gradingSchemeRepo = new InMemoryGradingSchemeRepository();
    assessmentItemRepo = new InMemoryAssessmentItemRepository();
    outcomeRepo = new InMemoryOutcomeRepository();
    service = new AssessmentService(gradingSchemeRepo, assessmentItemRepo, outcomeRepo);
  });

  // ─── Grading Scheme Tests ────────────────────────────────────────────────

  describe('createGradingScheme', () => {
    it('should create a numeric grading scheme', async () => {
      const input = {
        name: 'Percentage Scale',
        type: 'numeric' as const,
        minValue: 0,
        maxValue: 100,
        thresholds: [
          { grade: 'A', minScore: 90, maxScore: 100 },
          { grade: 'B', minScore: 80, maxScore: 89 },
          { grade: 'C', minScore: 70, maxScore: 79 },
          { grade: 'D', minScore: 60, maxScore: 69 },
          { grade: 'F', minScore: 0, maxScore: 59 },
        ],
      };

      const result = await service.createGradingScheme(tenantId, input);

      expect(result.id).toBeDefined();
      expect(result.tenantId).toBe(tenantId);
      expect(result.name).toBe('Percentage Scale');
      expect(result.type).toBe('numeric');
      expect(result.minValue).toBe(0);
      expect(result.maxValue).toBe(100);
      expect(result.thresholds).toHaveLength(5);
    });

    it('should create a letter grading scheme', async () => {
      const input = {
        name: 'Letter Grades',
        type: 'letter' as const,
        minValue: 0,
        maxValue: 4,
        thresholds: [
          { grade: 'A', minScore: 3.7, maxScore: 4 },
          { grade: 'B', minScore: 2.7, maxScore: 3.6 },
          { grade: 'C', minScore: 1.7, maxScore: 2.6 },
          { grade: 'F', minScore: 0, maxScore: 1.6 },
        ],
      };

      const result = await service.createGradingScheme(tenantId, input);
      expect(result.type).toBe('letter');
      expect(result.thresholds).toHaveLength(4);
    });

    it('should create a competency grading scheme with descriptors', async () => {
      const input = {
        name: 'Competency Levels',
        type: 'competency' as const,
        minValue: 1,
        maxValue: 4,
        thresholds: [
          {
            grade: 'Exceeding',
            minScore: 4,
            maxScore: 4,
            descriptor: 'Consistently exceeds expectations',
          },
          {
            grade: 'Meeting',
            minScore: 3,
            maxScore: 3,
            descriptor: 'Meets all expected standards',
          },
          {
            grade: 'Approaching',
            minScore: 2,
            maxScore: 2,
            descriptor: 'Approaching expected standards',
          },
          {
            grade: 'Beginning',
            minScore: 1,
            maxScore: 1,
            descriptor: 'Beginning to develop skills',
          },
        ],
      };

      const result = await service.createGradingScheme(tenantId, input);
      expect(result.type).toBe('competency');
      expect(result.thresholds[0]!.descriptor).toBe('Consistently exceeds expectations');
    });

    it('should reject if minValue >= maxValue', async () => {
      const input = {
        name: 'Invalid',
        type: 'numeric' as const,
        minValue: 100,
        maxValue: 0,
        thresholds: [{ grade: 'A', minScore: 0, maxScore: 100 }],
      };

      await expect(service.createGradingScheme(tenantId, input)).rejects.toThrow(BusinessRuleError);
    });

    it('should reject duplicate name within tenant', async () => {
      const input = {
        name: 'Standard Scale',
        type: 'numeric' as const,
        minValue: 0,
        maxValue: 100,
        thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
      };

      await service.createGradingScheme(tenantId, input);
      await expect(service.createGradingScheme(tenantId, input)).rejects.toThrow(ConflictError);
    });

    it('should reject overlapping thresholds', async () => {
      const input = {
        name: 'Overlapping',
        type: 'numeric' as const,
        minValue: 0,
        maxValue: 100,
        thresholds: [
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'B', minScore: 70, maxScore: 85 }, // overlaps with A
        ],
      };

      await expect(service.createGradingScheme(tenantId, input)).rejects.toThrow(BusinessRuleError);
    });

    it('should reject thresholds outside scheme range', async () => {
      const input = {
        name: 'Out of Range',
        type: 'numeric' as const,
        minValue: 0,
        maxValue: 100,
        thresholds: [
          { grade: 'A', minScore: 90, maxScore: 110 }, // exceeds maxValue
        ],
      };

      await expect(service.createGradingScheme(tenantId, input)).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('updateGradingScheme', () => {
    it('should update a grading scheme name', async () => {
      const created = await service.createGradingScheme(tenantId, {
        name: 'Original',
        type: 'numeric',
        minValue: 0,
        maxValue: 100,
        thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
      });

      const updated = await service.updateGradingScheme(tenantId, created.id, {
        name: 'Updated Name',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.type).toBe('numeric');
    });

    it('should throw NotFoundError for non-existent scheme', async () => {
      await expect(
        service.updateGradingScheme(tenantId, 'non-existent-id', { name: 'New' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteGradingScheme', () => {
    it('should delete an existing grading scheme', async () => {
      const created = await service.createGradingScheme(tenantId, {
        name: 'To Delete',
        type: 'numeric',
        minValue: 0,
        maxValue: 100,
        thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
      });

      await service.deleteGradingScheme(tenantId, created.id);
      await expect(service.getGradingScheme(tenantId, created.id)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for non-existent scheme', async () => {
      await expect(service.deleteGradingScheme(tenantId, 'non-existent')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  // ─── Assessment Item Tests ───────────────────────────────────────────────

  describe('defineAssessmentItems', () => {
    const subjectId = '11111111-1111-4111-8111-111111111111';
    const academicPeriodId = '22222222-2222-4222-8222-222222222222';
    let gradingSchemeId: string;

    beforeEach(async () => {
      const scheme = await service.createGradingScheme(tenantId, {
        name: 'Test Scale',
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

    it('should define assessment items that sum to 100%', async () => {
      const input = {
        subjectId,
        academicPeriodId,
        gradingSchemeId,
        items: [
          { name: 'Midterm', weight: 30, minScore: 0, maxScore: 100 },
          { name: 'Final', weight: 50, minScore: 0, maxScore: 100 },
          { name: 'Homework', weight: 20, minScore: 0, maxScore: 100 },
        ],
      };

      const result = await service.defineAssessmentItems(tenantId, input);

      expect(result).toHaveLength(3);
      expect(result[0]!.name).toBe('Midterm');
      expect(result[0]!.weight).toBe(30);
      expect(result[1]!.name).toBe('Final');
      expect(result[1]!.weight).toBe(50);
      expect(result[2]!.name).toBe('Homework');
      expect(result[2]!.weight).toBe(20);
    });

    it('should reject if weights do not sum to 100%', async () => {
      const input = {
        subjectId,
        academicPeriodId,
        gradingSchemeId,
        items: [
          { name: 'Midterm', weight: 30, minScore: 0, maxScore: 100 },
          { name: 'Final', weight: 50, minScore: 0, maxScore: 100 },
          // Total: 80%, missing 20%
        ],
      };

      await expect(service.defineAssessmentItems(tenantId, input)).rejects.toThrow(
        BusinessRuleError,
      );
      try {
        await service.defineAssessmentItems(tenantId, input);
      } catch (error) {
        expect((error as BusinessRuleError).message).toContain('100%');
        expect((error as BusinessRuleError).message).toContain('80');
      }
    });

    it('should reject if more than 50 items', async () => {
      const items = Array.from({ length: 51 }, (_, i) => ({
        name: `Item ${i + 1}`,
        weight: 100 / 51,
        minScore: 0,
        maxScore: 100,
      }));

      const input = {
        subjectId,
        academicPeriodId,
        gradingSchemeId,
        items,
      };

      await expect(service.defineAssessmentItems(tenantId, input)).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it('should accept exactly 50 items', async () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        name: `Item ${i + 1}`,
        weight: 2, // 50 * 2 = 100
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
      expect(result).toHaveLength(50);
    });

    it('should reject if grading scheme does not exist', async () => {
      const input = {
        subjectId,
        academicPeriodId,
        gradingSchemeId: '99999999-9999-4999-8999-999999999999',
        items: [{ name: 'Test', weight: 100, minScore: 0, maxScore: 100 }],
      };

      await expect(service.defineAssessmentItems(tenantId, input)).rejects.toThrow(NotFoundError);
    });

    it('should reject if item minScore >= maxScore', async () => {
      const input = {
        subjectId,
        academicPeriodId,
        gradingSchemeId,
        items: [{ name: 'Invalid', weight: 100, minScore: 100, maxScore: 50 }],
      };

      await expect(service.defineAssessmentItems(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should replace existing items for the same subject+period', async () => {
      // Define initial items
      await service.defineAssessmentItems(tenantId, {
        subjectId,
        academicPeriodId,
        gradingSchemeId,
        items: [{ name: 'Old Item', weight: 100, minScore: 0, maxScore: 100 }],
      });

      // Replace with new items
      const result = await service.defineAssessmentItems(tenantId, {
        subjectId,
        academicPeriodId,
        gradingSchemeId,
        items: [
          { name: 'New Item 1', weight: 60, minScore: 0, maxScore: 100 },
          { name: 'New Item 2', weight: 40, minScore: 0, maxScore: 100 },
        ],
      });

      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('New Item 1');

      // Verify old items are gone
      const items = await service.getAssessmentItems(tenantId, subjectId, academicPeriodId);
      expect(items).toHaveLength(2);
    });

    it('should validate outcome IDs exist', async () => {
      const input = {
        subjectId,
        academicPeriodId,
        gradingSchemeId,
        items: [
          {
            name: 'With Outcome',
            weight: 100,
            minScore: 0,
            maxScore: 100,
            outcomeIds: ['99999999-9999-4999-8999-999999999999'],
          },
        ],
      };

      await expect(service.defineAssessmentItems(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should accept valid outcome IDs', async () => {
      // Create an outcome first
      const outcome = await service.createOutcome(tenantId, {
        name: 'Algebra Basics',
        code: 'MATH-ALG-01',
        subjectId,
      });

      const input = {
        subjectId,
        academicPeriodId,
        gradingSchemeId,
        items: [
          {
            name: 'Algebra Test',
            weight: 100,
            minScore: 0,
            maxScore: 100,
            outcomeIds: [outcome.id],
          },
        ],
      };

      const result = await service.defineAssessmentItems(tenantId, input);
      expect(result[0]!.outcomeIds).toContain(outcome.id);
    });
  });

  // ─── Outcome Tests ───────────────────────────────────────────────────────

  describe('createOutcome', () => {
    it('should create a curriculum outcome', async () => {
      const subjectId = '11111111-1111-4111-8111-111111111111';
      const result = await service.createOutcome(tenantId, {
        name: 'Solve Linear Equations',
        code: 'MATH-01',
        description: 'Student can solve linear equations with one variable',
        subjectId,
      });

      expect(result.id).toBeDefined();
      expect(result.name).toBe('Solve Linear Equations');
      expect(result.code).toBe('MATH-01');
      expect(result.description).toBe('Student can solve linear equations with one variable');
      expect(result.subjectId).toBe(subjectId);
    });
  });

  describe('getOutcomesBySubject', () => {
    it('should return outcomes for a specific subject', async () => {
      const subjectId = '11111111-1111-4111-8111-111111111111';
      const otherSubjectId = '33333333-3333-4333-8333-333333333333';

      await service.createOutcome(tenantId, { name: 'Outcome 1', code: 'O1', subjectId });
      await service.createOutcome(tenantId, { name: 'Outcome 2', code: 'O2', subjectId });
      await service.createOutcome(tenantId, {
        name: 'Other',
        code: 'O3',
        subjectId: otherSubjectId,
      });

      const results = await service.getOutcomesBySubject(tenantId, subjectId);
      expect(results).toHaveLength(2);
      expect(results.every((o) => o.subjectId === subjectId)).toBe(true);
    });
  });

  describe('deleteOutcome', () => {
    it('should delete an existing outcome', async () => {
      const subjectId = '11111111-1111-4111-8111-111111111111';
      const outcome = await service.createOutcome(tenantId, {
        name: 'To Delete',
        code: 'DEL',
        subjectId,
      });

      await service.deleteOutcome(tenantId, outcome.id);
      const results = await service.getOutcomesBySubject(tenantId, subjectId);
      expect(results).toHaveLength(0);
    });

    it('should throw NotFoundError for non-existent outcome', async () => {
      await expect(service.deleteOutcome(tenantId, 'non-existent')).rejects.toThrow(NotFoundError);
    });
  });
});
