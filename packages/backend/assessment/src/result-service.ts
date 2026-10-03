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
import { BusinessRuleError, NotFoundError } from '@proctira/common';
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

/** PRC-M164: upper bound for one page of subject-wide grades. */
export const MAX_GRADE_PAGE_SIZE = 500;

/**
 * PRC-M161: tenant-scoped student existence port. Returns the subset of `studentIds`
 * that exist (and are not deleted) in the tenant.
 */
export interface ResultStudentDirectory {
  findExistingStudentIds(tenantId: string, studentIds: readonly string[]): Promise<Set<string>>;
  /**
   * PRC-M161: subset of `studentIds` with an ENROLLED enrolment in `academicPeriodId`.
   * Directories without enrolment data omit it (the check is then skipped).
   */
  findEnrolledStudentIds?(
    tenantId: string,
    academicPeriodId: string,
    studentIds: readonly string[],
  ): Promise<Set<string>>;
}

/**
 * PRC-M161 defaulted decision: the enrolment source of truth is the `enrollments` table and a
 * result may only be entered for a student ENROLLED in the item's academic period.
 * ASSESSMENT_RESULT_ENROLMENT_CHECK=off disables it (owner choice); default enforce.
 */
export function readEnrolmentCheckMode(
  env: Record<string, string | undefined> = process.env,
): 'enforce' | 'off' {
  return env['ASSESSMENT_RESULT_ENROLMENT_CHECK']?.trim().toLowerCase() === 'off'
    ? 'off'
    : 'enforce';
}

export interface ResultServiceOptions {
  /**
   * When provided, every result's student must exist in the tenant (single IN query per
   * call). Without it the `assessment_results_student_id_fkey` constraint is the backstop.
   */
  studentDirectory?: ResultStudentDirectory | null;
  /** PRC-M161: default readEnrolmentCheckMode() ('enforce'). */
  enrolmentCheck?: 'enforce' | 'off';
}

/** PRC-M164: optional page window for subject-wide grade listings. */
export interface GradeListPage {
  page?: number;
  limit?: number;
}

/**
 * Service handling assessment result business logic.
 */
export class ResultService {
  constructor(
    private readonly resultRepo: AssessmentResultRepository,
    private readonly assessmentItemRepo: AssessmentItemRepository,
    private readonly gradingSchemeRepo: GradingSchemeRepository,
    private readonly options: ResultServiceOptions = {},
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
      throw new NotFoundError(`Assessment item with id '${input.assessmentItemId}' not found`);
    }

    // PRC-M161: the item owns its subject/period; a mis-tagged entry is rejected (422).
    if (item.subjectId !== input.subjectId || item.academicPeriodId !== input.academicPeriodId) {
      throw new BusinessRuleError(
        `Assessment item '${item.name}' does not belong to the given subject and academic period`,
      );
    }

    // Validate score is within the item's score range
    this.validateScoreRange(input.score, item);

    const directory = this.options.studentDirectory;
    if (directory) {
      const existing = await directory.findExistingStudentIds(tenantId, [input.studentId]);
      if (!existing.has(input.studentId)) {
        throw new NotFoundError(`Student with id '${input.studentId}' not found`);
      }
    }
    const enrolled = await this.enrolledStudents(tenantId, item.academicPeriodId, [
      input.studentId,
    ]);
    if (enrolled && !enrolled.has(input.studentId)) {
      throw new BusinessRuleError(
        `Student '${input.studentId}' is not enrolled in the item's academic period`,
      );
    }

    // Upsert the result (subject/period derived from the item)
    const entity: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      assessmentItemId: input.assessmentItemId,
      subjectId: item.subjectId,
      academicPeriodId: item.academicPeriodId,
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

    // PRC-M164: one query for every item of the subject+period (instead of N lookups).
    // PRC-M161: items outside that subject+period are row errors, never persisted.
    const periodItems = await this.assessmentItemRepo.findBySubjectAndPeriod(
      tenantId,
      input.subjectId,
      input.academicPeriodId,
    );
    const itemMap = new Map<string, AssessmentItemEntity>(periodItems.map((i) => [i.id, i]));

    // PRC-M161: one tenant-scoped IN query for student existence.
    const directory = this.options.studentDirectory;
    const knownStudents = directory
      ? await directory.findExistingStudentIds(tenantId, [
          ...new Set(input.results.map((r) => r.studentId)),
        ])
      : null;

    // PRC-M161: one enrolment query for the subject+period of this batch.
    const enrolledStudents = await this.enrolledStudents(tenantId, input.academicPeriodId, [
      ...new Set(input.results.map((r) => r.studentId)),
    ]);
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
          message: `Assessment item with id '${row.assessmentItemId}' not found for the given subject and academic period`,
        });
        continue;
      }

      if (knownStudents && !knownStudents.has(row.studentId)) {
        errors.push({
          row: i,
          studentId: row.studentId,
          assessmentItemId: row.assessmentItemId,
          field: 'studentId',
          message: `Student with id '${row.studentId}' not found`,
        });
        continue;
      }
      if (enrolledStudents && !enrolledStudents.has(row.studentId)) {
        errors.push({
          row: i,
          studentId: row.studentId,
          assessmentItemId: row.assessmentItemId,
          field: 'studentId',
          message: `Student '${row.studentId}' is not enrolled in the academic period`,
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
        subjectId: item.subjectId,
        academicPeriodId: item.academicPeriodId,
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

    const gradingScheme = await this.loadScheme(tenantId, items);

    // Get student's results for this subject+period
    const results = await this.resultRepo.findByStudentSubjectPeriod(
      tenantId,
      studentId,
      subjectId,
      academicPeriodId,
    );

    return this.computeGrade(studentId, subjectId, academicPeriodId, items, gradingScheme, results);
  }

  /** Grading scheme shared by the subject+period items (taken from the first item). */
  private async loadScheme(
    tenantId: string,
    items: AssessmentItemEntity[],
  ): Promise<GradingSchemeEntity> {
    const gradingScheme = await this.gradingSchemeRepo.findById(
      items[0]!.gradingSchemeId,
      tenantId,
    );
    if (!gradingScheme) {
      throw new NotFoundError(`Grading scheme with id '${items[0]!.gradingSchemeId}' not found`);
    }
    return gradingScheme;
  }

  /** Pure weighted-average + grade computation over pre-loaded items/scheme/results. */
  private computeGrade(
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
    items: AssessmentItemEntity[],
    gradingScheme: GradingSchemeEntity,
    results: AssessmentResultEntity[],
  ): StudentSubjectResult {
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
    return (await this.calculateGradesPage(tenantId, subjectId, academicPeriodId, {})).data;
  }

  /**
   * PRC-M164: paged subject-wide grades. With `limit` the window is capped at
   * MAX_GRADE_PAGE_SIZE; `total` is the number of graded students.
   */
  async calculateGradesPage(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
    pageOpts: GradeListPage,
  ): Promise<{ data: StudentSubjectResult[]; total: number; page: number; limit: number | null }> {
    // PRC-M164: items + scheme + all results loaded once (3 queries), grouped in memory.
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
    const gradingScheme = await this.loadScheme(tenantId, items);
    const allResults = await this.resultRepo.findBySubjectPeriod(
      tenantId,
      subjectId,
      academicPeriodId,
    );

    const byStudent = new Map<string, AssessmentResultEntity[]>();
    for (const r of allResults) {
      const list = byStudent.get(r.studentId);
      if (list) list.push(r);
      else byStudent.set(r.studentId, [r]);
    }

    const allStudentIds = [...byStudent.keys()];
    let studentIds = allStudentIds;
    let page = 1;
    let limit: number | null = null;
    if (pageOpts.limit !== undefined) {
      limit = Math.max(1, Math.min(MAX_GRADE_PAGE_SIZE, Math.floor(pageOpts.limit)));
      page = Math.max(1, Math.floor(pageOpts.page ?? 1));
      studentIds = allStudentIds.slice((page - 1) * limit, page * limit);
    }

    const data = studentIds.map((studentId) =>
      this.computeGrade(
        studentId,
        subjectId,
        academicPeriodId,
        items,
        gradingScheme,
        byStudent.get(studentId)!,
      ),
    );
    return { data, total: allStudentIds.length, page, limit };
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
      if (
        row.score === undefined ||
        row.score === null ||
        typeof row.score !== 'number' ||
        isNaN(row.score)
      ) {
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
  /** PRC-M161: enrolled subset, or null when the check is off or unsupported. */
  private async enrolledStudents(
    tenantId: string,
    academicPeriodId: string,
    studentIds: readonly string[],
  ): Promise<Set<string> | null> {
    const directory = this.options.studentDirectory;
    const mode = this.options.enrolmentCheck ?? readEnrolmentCheckMode();
    if (mode === 'off' || !directory?.findEnrolledStudentIds || studentIds.length === 0) {
      return null;
    }
    return directory.findEnrolledStudentIds(tenantId, academicPeriodId, studentIds);
  }

  private validateScoreRange(score: number, item: AssessmentItemEntity): void {
    if (score < item.minScore || score > item.maxScore) {
      throw new BusinessRuleError(
        `Score ${score} is outside the valid range [${item.minScore}, ${item.maxScore}] for assessment item '${item.name}'`,
      );
    }
  }

  /** Assign a grade based on the weighted average and threshold boundaries. */
  private assignGrade(
    score: number,
    thresholds: GradeThreshold[],
  ): { grade: string; descriptor: string | null } {
    return assignGradeForScore(score, thresholds);
  }
}

/**
 * PRC-H114: half-open bands — the highest band whose minScore <= score wins, so an
 * unrounded weighted average (e.g. 79.995 between B ≤79.99 and A ≥80) still gets
 * exactly one grade. Scores outside [lowest min, highest max] stay 'Ungraded'.
 */
export function assignGradeForScore(
  score: number,
  thresholds: GradeThreshold[],
): { grade: string; descriptor: string | null } {
  if (thresholds.length === 0) return { grade: 'Ungraded', descriptor: null };
  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
  const topMax = Math.max(...thresholds.map((t) => t.maxScore));
  if (score > topMax) return { grade: 'Ungraded', descriptor: null };
  for (const threshold of sorted) {
    if (score >= threshold.minScore) {
      return { grade: threshold.grade, descriptor: threshold.descriptor ?? null };
    }
  }
  return { grade: 'Ungraded', descriptor: null };
}
