/**
 * Assessment Result Service
 *
 * Business logic for assessment result operations including:
 * - Score validation within grading scheme range
 * - Weighted average calculation from individual item scores
 * - Grade assignment based on configured threshold boundaries
 * - Bulk entry support (up to 5000 rows)
 * - Row-level validation error reporting
 *
 * Requirements:
 * - 8.4: Validate scores within range, calculate weighted averages, assign grades
 * - 8.5: Reject out-of-range scores with error indicating valid range
 * - 8.8: Bulk entry up to 5000 rows with row-level validation errors
 */
import {
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from '@proctira/common';
import type { FieldError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  AssessmentItemEntity,
  AssessmentItemRepository,
  GradingSchemeEntity,
  GradingSchemeRepository,
} from './assessment-repository.js';
import type {
  AssessmentResultEntity,
  AssessmentResultRepository,
  StudentSubjectResult,
} from './result-repository.js';
import type {
  EnterSingleResultInput,
  BulkResultEntryInput,
  RowValidationError,
  BulkResultEntryResponse,
} from './result-schemas.js';
import { MAX_BULK_RESULT_ROWS } from './result-schemas.js';
import type { GradeThreshold } from './schemas.js';

/**
 * Service handling assessment result business logic.
 */
export class ResultService {
  constructor(
    private readonly resultRepo: AssessmentResultRepository,
    private readonly assessmentItemRepo: AssessmentItemRepository,
    private readonly gradingSchemeRepo: GradingSchemeRepository,
  ) {}

  /**
   * Enter a single assessment result with validation.
   *
   * Validates:
   * - Assessment item exists
   * - Score is within the item's min/max range (grading scheme bounds)
   *
   * Requirement 8.4: Validate score within range
   * Requirement 8.5: Reject out-of-range with error message
   *
   * @throws NotFoundError if assessment item not found
   * @throws BusinessRuleError if score is out of range
   */
  async enterSingleResult(
    tenantId: string,
    input: EnterSingleResultInput,
  ): Promise<AssessmentResultEntity> {
    // Validate assessment item exists
    const item = await this.assessmentItemRepo.findById(input.assessmentItemId, tenantId);
    if (!item) {
      throw new NotFoundError(
        `Assessment item with id '${input.assessmentItemId}' not found`,
      );
    }

    // Validate score is within the item's score range
    this.validateScoreRange(input.score, item);

    // Upsert the result
    const entity: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      assessmentItemId: input.assessmentItemId,
      subjectId: input.subjectId,
      academicPeriodId: input.academicPeriodId,
      score: input.score,
    };

    return this.resultRepo.upsert(entity);
  }

  /**
   * Enter assessment results in bulk (data grid or Excel import).
   *
   * Validates each row independently:
   * - Assessment item exists
   * - Score is within the item's min/max range
   *
   * Valid rows are imported; invalid rows are rejected with row-level errors.
   *
   * Requirement 8.4: Validate scores within range
   * Requirement 8.5: Reject out-of-range with error message
   * Requirement 8.8: Up to 5000 rows, row-level validation errors
   *
   * @throws BusinessRuleError if more than 5000 rows submitted
   */
  async enterBulkResults(
    tenantId: string,
    input: BulkResultEntryInput,
  ): Promise<BulkResultEntryResponse> {
    // Validate row count
    if (input.results.length > MAX_BULK_RESULT_ROWS) {
      throw new BusinessRuleError(
        `Bulk result entry supports a maximum of ${MAX_BULK_RESULT_ROWS} rows per operation. Received: ${input.results.length}`,
      );
    }

    // Collect all unique assessment item IDs for batch lookup
    const uniqueItemIds = [...new Set(input.results.map((r) => r.assessmentItemId))];

    // Batch fetch all referenced assessment items
    const itemMap = new Map<string, AssessmentItemEntity>();
    for (const itemId of uniqueItemIds) {
      const item = await this.assessmentItemRepo.findById(itemId, tenantId);
      if (item) {
        itemMap.set(itemId, item);
      }
    }

    // Validate each row
    const validEntries: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>[] = [];
    const errors: RowValidationError[] = [];

    for (let i = 0; i < input.results.length; i++) {
      const row = input.results[i]!;
      const item = itemMap.get(row.assessmentItemId);

      if (!item) {
        errors.push({
          row: i,
          studentId: row.studentId,
          assessmentItemId: row.assessmentItemId,
          field: 'assessmentItemId',
          message: `Assessment item with id '${row.assessmentItemId}' not found`,
        });
        continue;
      }

      // Validate score range
      if (row.score < item.minScore || row.score > item.maxScore) {
        errors.push({
          row: i,
          studentId: row.studentId,
          assessmentItemId: row.assessmentItemId,
          field: 'score',
          message: `Score ${row.score} is outside the valid range [${item.minScore}, ${item.maxScore}] for assessment item '${item.name}'`,
        });
        continue;
      }

      validEntries.push({
        id: uuidv4(),
        tenantId,
        studentId: row.studentId,
        assessmentItemId: row.assessmentItemId,
        subjectId: input.subjectId,
        academicPeriodId: input.academicPeriodId,
        score: row.score,
      });
    }

    // Bulk upsert valid entries
    let savedResults: AssessmentResultEntity[] = [];
    if (validEntries.length > 0) {
      savedResults = await this.resultRepo.bulkUpsert(validEntries);
    }

    return {
      totalRows: input.results.length,
      successCount: savedResults.length,
      errorCount: errors.length,
      results: savedResults.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        assessmentItemId: r.assessmentItemId,
        score: r.score,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      errors,
    };
  }

  /**
   * Calculate weighted average and assign grade for a student in a subject+period.
   *
   * Requirement 8.4: Calculate weighted averages and assign grades.
   *
   * @throws NotFoundError if no assessment items found for subject+period
   */
  async calculateStudentGrade(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<StudentSubjectResult> {
    // Get assessment items for the subject+period
    const items = await this.assessmentItemRepo.findBySubjectAndPeriod(
      tenantId,
      subjectId,
      academicPeriodId,
    );

    if (items.length === 0) {
      throw new NotFoundError(
        `No assessment items found for subject '${subjectId}' in period '${academicPeriodId}'`,
      );
    }

    // Get the grading scheme from the first item (all items share the same scheme)
    const gradingScheme = await this.gradingSchemeRepo.findById(items[0]!.gradingSchemeId, tenantId);
    if (!gradingScheme) {
      throw new NotFoundError(
        `Grading scheme with id '${items[0]!.gradingSchemeId}' not found`,
      );
    }

    // Get student's results for this subject+period
    const results = await this.resultRepo.findByStudentSubjectPeriod(
      tenantId,
      studentId,
      subjectId,
      academicPeriodId,
    );

    // Build a map of assessmentItemId -> score
    const scoreMap = new Map<string, number>();
    for (const result of results) {
      scoreMap.set(result.assessmentItemId, result.score);
    }

    // Calculate weighted scores for each item
    const itemScores: StudentSubjectResult['itemScores'] = [];
    let totalWeightedScore = 0;
    let totalWeight = 0;

    for (const item of items) {
      const score = scoreMap.get(item.id);
      if (score !== undefined) {
        // Normalize score to percentage of item's max score, then apply weight
        const normalizedScore = ((score - item.minScore) / (item.maxScore - item.minScore)) * 100;
        const weightedScore = (normalizedScore * item.weight) / 100;

        itemScores.push({
          assessmentItemId: item.id,
          score,
          weight: item.weight,
          weightedScore: Math.round(weightedScore * 100) / 100,
        });

        totalWeightedScore += weightedScore;
        totalWeight += item.weight;
      }
    }

    // Calculate weighted average (scaled to grading scheme range)
    let weightedAverage = 0;
    if (totalWeight > 0) {
      // totalWeightedScore is already a percentage (0-100 scale)
      // Scale it to the grading scheme's range
      const range = gradingScheme.maxValue - gradingScheme.minValue;
      weightedAverage = gradingScheme.minValue + (totalWeightedScore / 100) * range;
    }

    // Round to 2 decimal places
    weightedAverage = Math.round(weightedAverage * 100) / 100;

    // Assign grade based on thresholds
    const { grade, descriptor } = this.assignGrade(weightedAverage, gradingScheme.thresholds);

    return {
      studentId,
      subjectId,
      academicPeriodId,
      itemScores,
      weightedAverage,
      grade,
      gradeDescriptor: descriptor,
    };
  }

  /**
   * Calculate grades for all students with results in a subject+period.
   *
   * Requirement 8.4: Calculate weighted averages and assign grades.
   */
  async calculateAllGrades(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<StudentSubjectResult[]> {
    // Get all results for the subject+period
    const allResults = await this.resultRepo.findBySubjectPeriod(
      tenantId,
      subjectId,
      academicPeriodId,
    );

    // Get unique student IDs
    const studentIds = [...new Set(allResults.map((r) => r.studentId))];

    // Calculate grade for each student
    const grades: StudentSubjectResult[] = [];
    for (const studentId of studentIds) {
      const grade = await this.calculateStudentGrade(
        tenantId,
        studentId,
        subjectId,
        academicPeriodId,
      );
      grades.push(grade);
    }

    return grades;
  }

  /**
   * Parse Excel data for bulk import.
   *
   * Expected columns: studentId, assessmentItemId, score
   * Validates format and delegates to enterBulkResults for business validation.
   *
   * Requirement 8.8: Excel import for up to 5000 rows.
   *
   * @param rows - Parsed rows from Excel file (array of objects)
   */
  async importFromExcel(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
    rows: Array<{ studentId: string; assessmentItemId: string; score: number }>,
  ): Promise<BulkResultEntryResponse> {
    // Validate row count
    if (rows.length > MAX_BULK_RESULT_ROWS) {
      throw new BusinessRuleError(
        `Excel import supports a maximum of ${MAX_BULK_RESULT_ROWS} rows per operation. Received: ${rows.length}`,
      );
    }

    // Validate row format and collect format errors
    const formatErrors: RowValidationError[] = [];
    const validRows: Array<{ studentId: string; assessmentItemId: string; score: number }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const rowErrors: string[] = [];

      if (!row.studentId || typeof row.studentId !== 'string') {
        rowErrors.push('studentId is required and must be a string');
      }
      if (!row.assessmentItemId || typeof row.assessmentItemId !== 'string') {
        rowErrors.push('assessmentItemId is required and must be a string');
      }
      if (row.score === undefined || row.score === null || typeof row.score !== 'number' || isNaN(row.score)) {
        rowErrors.push('score is required and must be a number');
      }

      if (rowErrors.length > 0) {
        formatErrors.push({
          row: i,
          studentId: row.studentId || 'unknown',
          assessmentItemId: row.assessmentItemId || 'unknown',
          field: 'format',
          message: rowErrors.join('; '),
        });
      } else {
        validRows.push(row);
      }
    }

    // If all rows have format errors, return early
    if (validRows.length === 0) {
      return {
        totalRows: rows.length,
        successCount: 0,
        errorCount: formatErrors.length,
        results: [],
        errors: formatErrors,
      };
    }

    // Delegate to bulk entry for business validation
    const bulkResult = await this.enterBulkResults(tenantId, {
      subjectId,
      academicPeriodId,
      results: validRows,
    });

    // Merge format errors with business validation errors
    // Adjust row indices for business errors to account for format-filtered rows
    return {
      totalRows: rows.length,
      successCount: bulkResult.successCount,
      errorCount: formatErrors.length + bulkResult.errorCount,
      results: bulkResult.results,
      errors: [...formatErrors, ...bulkResult.errors],
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Validate that a score falls within the assessment item's defined range.
   *
   * Requirement 8.5: Reject out-of-range scores with error indicating valid range.
   *
   * @throws BusinessRuleError if score is outside the valid range
   */
  private validateScoreRange(score: number, item: AssessmentItemEntity): void {
    if (score < item.minScore || score > item.maxScore) {
      throw new BusinessRuleError(
        `Score ${score} is outside the valid range [${item.minScore}, ${item.maxScore}] for assessment item '${item.name}'`,
      );
    }
  }

  /**
   * Assign a grade based on the weighted average and threshold boundaries.
   *
   * Finds the threshold where minScore <= score <= maxScore.
   * If no threshold matches, returns 'Ungraded'.
   */
  private assignGrade(
    score: number,
    thresholds: GradeThreshold[],
  ): { grade: string; descriptor: string | null } {
    // Sort thresholds by minScore descending to find the highest matching grade
    const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);

    for (const threshold of sorted) {
      if (score >= threshold.minScore && score <= threshold.maxScore) {
        return {
          grade: threshold.grade,
          descriptor: threshold.descriptor ?? null,
        };
      }
    }

    return { grade: 'Ungraded', descriptor: null };
  }
}
