/**
 * Unit tests for ResultService
 *
 * Tests score validation, weighted average calculation, grade assignment,
 * bulk entry with row-level errors, and Excel import.
 *
 * Requirements: 8.4, 8.5, 8.8
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BusinessRuleError, NotFoundError } from '@proctira/common';

import { AssessmentService } from './assessment-service.js';
import { ResultService } from './result-service.js';
import {
  InMemoryGradingSchemeRepository,
  InMemoryAssessmentItemRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import type { AssessmentItemEntity } from './assessment-repository.js';

describe('ResultService', () => {
  let resultService: ResultService;
  let assessmentService: AssessmentService;
  let gradingSchemeRepo: InMemoryGradingSchemeRepository;
  let assessmentItemRepo: InMemoryAssessmentItemRepository;
  let outcomeRepo: InMemoryOutcomeRepository;
  let resultRepo: InMemoryAssessmentResultRepository;

  const tenantId = 'tenant-001';
  const subjectId = '11111111-1111-4111-8111-111111111111';
  const academicPeriodId = '22222222-2222-4222-8222-222222222222';
  const studentId = '33333333-3333-4333-8333-333333333333';

  let gradingSchemeId: string;
  let items: AssessmentItemEntity[];

  beforeEach(async () => {
    gradingSchemeRepo = new InMemoryGradingSchemeRepository();
    assessmentItemRepo = new InMemoryAssessmentItemRepository();
    outcomeRepo = new InMemoryOutcomeRepository();
    resultRepo = new InMemoryAssessmentResultRepository();

    assessmentService = new AssessmentService(gradingSchemeRepo, assessmentItemRepo, outcomeRepo);

    resultService = new ResultService(resultRepo, assessmentItemRepo, gradingSchemeRepo);

    // Set up a grading scheme with thresholds
    const scheme = await assessmentService.createGradingScheme(tenantId, {
      name: 'Percentage Scale',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [
        { grade: 'A', minScore: 90, maxScore: 100 },
        { grade: 'B', minScore: 80, maxScore: 89 },
        { grade: 'C', minScore: 70, maxScore: 79 },
        { grade: 'D', minScore: 60, maxScore: 69 },
        { grade: 'F', minScore: 0, maxScore: 59 },
      ],
    });
    gradingSchemeId = scheme.id;

    // Define assessment items
    items = await assessmentService.defineAssessmentItems(tenantId, {
      subjectId,
      academicPeriodId,
      gradingSchemeId,
      items: [
        { name: 'Midterm', weight: 30, minScore: 0, maxScore: 100 },
        { name: 'Final', weight: 50, minScore: 0, maxScore: 100 },
        { name: 'Homework', weight: 20, minScore: 0, maxScore: 50 },
      ],
    });
  });

  // ─── Single Result Entry Tests ─────────────────────────────────────────

  describe('enterSingleResult', () => {
    it('should enter a valid score within range', async () => {
      const result = await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 85,
      });

      expect(result.id).toBeDefined();
      expect(result.studentId).toBe(studentId);
      expect(result.assessmentItemId).toBe(items[0]!.id);
      expect(result.score).toBe(85);
    });

    it('should accept minimum score (boundary)', async () => {
      const result = await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 0, // minScore for Midterm
      });

      expect(result.score).toBe(0);
    });

    it('should accept maximum score (boundary)', async () => {
      const result = await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 100, // maxScore for Midterm
      });

      expect(result.score).toBe(100);
    });

    it('should reject score below minimum range (Requirement 8.5)', async () => {
      await expect(
        resultService.enterSingleResult(tenantId, {
          subjectId,
          academicPeriodId,
          studentId,
          assessmentItemId: items[0]!.id,
          score: -1, // below minScore of 0
        }),
      ).rejects.toThrow(BusinessRuleError);

      try {
        await resultService.enterSingleResult(tenantId, {
          subjectId,
          academicPeriodId,
          studentId,
          assessmentItemId: items[0]!.id,
          score: -1,
        });
      } catch (error) {
        expect((error as BusinessRuleError).message).toContain('[0, 100]');
        expect((error as BusinessRuleError).message).toContain('-1');
      }
    });

    it('should reject score above maximum range (Requirement 8.5)', async () => {
      await expect(
        resultService.enterSingleResult(tenantId, {
          subjectId,
          academicPeriodId,
          studentId,
          assessmentItemId: items[0]!.id,
          score: 101, // above maxScore of 100
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should reject score above item-specific max (Homework max is 50)', async () => {
      await expect(
        resultService.enterSingleResult(tenantId, {
          subjectId,
          academicPeriodId,
          studentId,
          assessmentItemId: items[2]!.id, // Homework, maxScore = 50
          score: 51,
        }),
      ).rejects.toThrow(BusinessRuleError);

      try {
        await resultService.enterSingleResult(tenantId, {
          subjectId,
          academicPeriodId,
          studentId,
          assessmentItemId: items[2]!.id,
          score: 51,
        });
      } catch (error) {
        expect((error as BusinessRuleError).message).toContain('[0, 50]');
      }
    });

    it('should throw NotFoundError for non-existent assessment item', async () => {
      await expect(
        resultService.enterSingleResult(tenantId, {
          subjectId,
          academicPeriodId,
          studentId,
          assessmentItemId: '99999999-9999-4999-8999-999999999999',
          score: 85,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should update existing result on re-entry (upsert)', async () => {
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 70,
      });

      const updated = await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 85,
      });

      expect(updated.score).toBe(85);
    });
  });

  // ─── Weighted Average and Grade Calculation Tests ──────────────────────

  describe('calculateStudentGrade', () => {
    it('should calculate weighted average and assign correct grade (Requirement 8.4)', async () => {
      // Enter scores: Midterm=90, Final=80, Homework=40 (out of 50)
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 90,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[1]!.id,
        score: 80,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[2]!.id,
        score: 40, // 40/50 = 80%
      });

      const result = await resultService.calculateStudentGrade(
        tenantId,
        studentId,
        subjectId,
        academicPeriodId,
      );

      expect(result.studentId).toBe(studentId);
      expect(result.subjectId).toBe(subjectId);
      expect(result.itemScores).toHaveLength(3);

      // Weighted average calculation:
      // Midterm: (90/100)*100 = 90% normalized, weighted = 90*30/100 = 27
      // Final: (80/100)*100 = 80% normalized, weighted = 80*50/100 = 40
      // Homework: (40/50)*100 = 80% normalized, weighted = 80*20/100 = 16
      // Total weighted = 27 + 40 + 16 = 83
      // Scaled to scheme range [0,100]: 0 + (83/100)*100 = 83
      expect(result.weightedAverage).toBe(83);
      expect(result.grade).toBe('B'); // 80-89 range
    });

    it('should assign A grade for high scores', async () => {
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 95,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[1]!.id,
        score: 92,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[2]!.id,
        score: 48, // 48/50 = 96%
      });

      const result = await resultService.calculateStudentGrade(
        tenantId,
        studentId,
        subjectId,
        academicPeriodId,
      );

      // Midterm: 95% * 30/100 = 28.5
      // Final: 92% * 50/100 = 46
      // Homework: 96% * 20/100 = 19.2
      // Total = 93.7 → grade A (90-100)
      expect(result.weightedAverage).toBe(93.7);
      expect(result.grade).toBe('A');
    });

    it('should assign F grade for low scores', async () => {
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 30,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[1]!.id,
        score: 40,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[2]!.id,
        score: 10, // 10/50 = 20%
      });

      const result = await resultService.calculateStudentGrade(
        tenantId,
        studentId,
        subjectId,
        academicPeriodId,
      );

      // Midterm: 30% * 30/100 = 9
      // Final: 40% * 50/100 = 20
      // Homework: 20% * 20/100 = 4
      // Total = 33 → grade F (0-59)
      expect(result.weightedAverage).toBe(33);
      expect(result.grade).toBe('F');
    });

    it('should handle partial results (not all items scored)', async () => {
      // Only enter Midterm score
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 90,
      });

      const result = await resultService.calculateStudentGrade(
        tenantId,
        studentId,
        subjectId,
        academicPeriodId,
      );

      // Only Midterm: 90% * 30/100 = 27
      // Total weighted = 27, total weight = 30
      // Scaled: 0 + (27/100)*100 = 27
      expect(result.itemScores).toHaveLength(1);
      expect(result.weightedAverage).toBe(27);
      expect(result.grade).toBe('F'); // 27 is in F range (0-59)
    });

    it('should throw NotFoundError if no assessment items exist', async () => {
      await expect(
        resultService.calculateStudentGrade(
          tenantId,
          studentId,
          '99999999-9999-4999-8999-999999999999', // non-existent subject
          academicPeriodId,
        ),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Bulk Entry Tests ──────────────────────────────────────────────────

  describe('enterBulkResults', () => {
    it('should import all valid rows successfully (Requirement 8.8)', async () => {
      const student2 = '44444444-4444-4444-8444-444444444444';

      const response = await resultService.enterBulkResults(tenantId, {
        subjectId,
        academicPeriodId,
        results: [
          { studentId, assessmentItemId: items[0]!.id, score: 85 },
          { studentId, assessmentItemId: items[1]!.id, score: 90 },
          { studentId: student2, assessmentItemId: items[0]!.id, score: 75 },
        ],
      });

      expect(response.totalRows).toBe(3);
      expect(response.successCount).toBe(3);
      expect(response.errorCount).toBe(0);
      expect(response.results).toHaveLength(3);
      expect(response.errors).toHaveLength(0);
    });

    it('should report row-level errors for invalid scores (Requirement 8.5, 8.8)', async () => {
      const response = await resultService.enterBulkResults(tenantId, {
        subjectId,
        academicPeriodId,
        results: [
          { studentId, assessmentItemId: items[0]!.id, score: 85 }, // valid
          { studentId, assessmentItemId: items[0]!.id, score: 150 }, // invalid: > 100
          { studentId, assessmentItemId: items[2]!.id, score: 60 }, // invalid: > 50 (Homework max)
        ],
      });

      expect(response.totalRows).toBe(3);
      expect(response.successCount).toBe(1);
      expect(response.errorCount).toBe(2);
      expect(response.results).toHaveLength(1);
      expect(response.errors).toHaveLength(2);

      // Check error details
      expect(response.errors[0]!.row).toBe(1);
      expect(response.errors[0]!.field).toBe('score');
      expect(response.errors[0]!.message).toContain('[0, 100]');

      expect(response.errors[1]!.row).toBe(2);
      expect(response.errors[1]!.field).toBe('score');
      expect(response.errors[1]!.message).toContain('[0, 50]');
    });

    it('should report error for non-existent assessment item', async () => {
      const response = await resultService.enterBulkResults(tenantId, {
        subjectId,
        academicPeriodId,
        results: [
          { studentId, assessmentItemId: '99999999-9999-4999-8999-999999999999', score: 85 },
        ],
      });

      expect(response.errorCount).toBe(1);
      expect(response.errors[0]!.field).toBe('assessmentItemId');
      expect(response.errors[0]!.message).toContain('not found');
    });

    it('should import valid rows and reject invalid rows independently', async () => {
      const response = await resultService.enterBulkResults(tenantId, {
        subjectId,
        academicPeriodId,
        results: [
          { studentId, assessmentItemId: items[0]!.id, score: 85 }, // valid
          { studentId, assessmentItemId: items[1]!.id, score: -5 }, // invalid
          { studentId, assessmentItemId: items[2]!.id, score: 45 }, // valid (within 0-50)
        ],
      });

      expect(response.successCount).toBe(2);
      expect(response.errorCount).toBe(1);
      expect(response.results).toHaveLength(2);
      expect(response.errors).toHaveLength(1);
      expect(response.errors[0]!.row).toBe(1);
    });

    it('should reject if more than 5000 rows', async () => {
      const results = Array.from({ length: 5001 }, (_, i) => ({
        studentId,
        assessmentItemId: items[0]!.id,
        score: 50,
      }));

      await expect(
        resultService.enterBulkResults(tenantId, {
          subjectId,
          academicPeriodId,
          results,
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should accept exactly 5000 rows', async () => {
      const results = Array.from({ length: 5000 }, () => ({
        studentId,
        assessmentItemId: items[0]!.id,
        score: 50,
      }));

      const response = await resultService.enterBulkResults(tenantId, {
        subjectId,
        academicPeriodId,
        results,
      });

      expect(response.totalRows).toBe(5000);
      expect(response.successCount).toBe(5000);
    });
  });

  // ─── Excel Import Tests ────────────────────────────────────────────────

  describe('importFromExcel', () => {
    it('should import valid Excel rows', async () => {
      const rows = [
        { studentId, assessmentItemId: items[0]!.id, score: 85 },
        { studentId, assessmentItemId: items[1]!.id, score: 90 },
      ];

      const response = await resultService.importFromExcel(
        tenantId,
        subjectId,
        academicPeriodId,
        rows,
      );

      expect(response.totalRows).toBe(2);
      expect(response.successCount).toBe(2);
      expect(response.errorCount).toBe(0);
    });

    it('should report format errors for invalid row data', async () => {
      const rows = [
        { studentId, assessmentItemId: items[0]!.id, score: 85 }, // valid
        { studentId: '', assessmentItemId: items[0]!.id, score: 85 }, // invalid: empty studentId
        { studentId, assessmentItemId: '', score: 85 }, // invalid: empty assessmentItemId
      ] as Array<{ studentId: string; assessmentItemId: string; score: number }>;

      const response = await resultService.importFromExcel(
        tenantId,
        subjectId,
        academicPeriodId,
        rows,
      );

      expect(response.totalRows).toBe(3);
      expect(response.successCount).toBe(1);
      expect(response.errorCount).toBe(2);
    });

    it('should reject if more than 5000 rows in Excel', async () => {
      const rows = Array.from({ length: 5001 }, () => ({
        studentId,
        assessmentItemId: items[0]!.id,
        score: 50,
      }));

      await expect(
        resultService.importFromExcel(tenantId, subjectId, academicPeriodId, rows),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should combine format and business validation errors', async () => {
      const rows = [
        { studentId, assessmentItemId: items[0]!.id, score: 85 }, // valid
        { studentId: '', assessmentItemId: items[0]!.id, score: 85 }, // format error
        { studentId, assessmentItemId: items[0]!.id, score: 150 }, // business error (out of range)
      ] as Array<{ studentId: string; assessmentItemId: string; score: number }>;

      const response = await resultService.importFromExcel(
        tenantId,
        subjectId,
        academicPeriodId,
        rows,
      );

      expect(response.totalRows).toBe(3);
      expect(response.successCount).toBe(1);
      expect(response.errorCount).toBe(2);
    });
  });

  // ─── Calculate All Grades Tests ────────────────────────────────────────

  describe('calculateAllGrades', () => {
    it('should calculate grades for multiple students', async () => {
      const student2 = '44444444-4444-4444-8444-444444444444';

      // Student 1 scores
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 90,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[1]!.id,
        score: 85,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[2]!.id,
        score: 45,
      });

      // Student 2 scores
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId: student2,
        assessmentItemId: items[0]!.id,
        score: 60,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId: student2,
        assessmentItemId: items[1]!.id,
        score: 55,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId: student2,
        assessmentItemId: items[2]!.id,
        score: 20,
      });

      const grades = await resultService.calculateAllGrades(tenantId, subjectId, academicPeriodId);

      expect(grades).toHaveLength(2);

      const student1Grade = grades.find((g) => g.studentId === studentId);
      const student2Grade = grades.find((g) => g.studentId === student2);

      expect(student1Grade).toBeDefined();
      expect(student2Grade).toBeDefined();

      // Student 1: Midterm 90%*30/100=27, Final 85%*50/100=42.5, HW (45/50=90%)*20/100=18 → 87.5 → B
      expect(student1Grade!.grade).toBe('B');

      // Student 2: Midterm 60%*30/100=18, Final 55%*50/100=27.5, HW (20/50=40%)*20/100=8 → 53.5 → F
      expect(student2Grade!.grade).toBe('F');
    });
  });
});
