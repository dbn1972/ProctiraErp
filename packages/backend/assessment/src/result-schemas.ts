/**
 * Typebox schemas for Assessment Result entry and validation.
 *
 * Defines schemas for:
 * - Single result entry
 * - Bulk result entry (data grid)
 * - Excel import for bulk results
 * - Result response with grade calculation
 *
 * Requirements: 8.4, 8.5, 8.8
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── UUID Pattern ────────────────────────────────────────────────────────────

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ─── Result Entry Schemas ────────────────────────────────────────────────────

/**
 * A single score entry for one student on one assessment item.
 */
export const ResultEntryItemSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN, description: 'Student UUID' }),
  assessmentItemId: Type.String({ pattern: UUID_PATTERN, description: 'Assessment item UUID' }),
  score: Type.Number({ description: 'Score value (must be within grading scheme range)' }),
});

export type ResultEntryItem = Static<typeof ResultEntryItemSchema>;

/**
 * Schema for entering a single result.
 * Requirement 8.4: Validate score within grading scheme range.
 */
export const EnterSingleResultSchema = Type.Object({
  subjectId: Type.String({ pattern: UUID_PATTERN, description: 'Subject UUID' }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
  studentId: Type.String({ pattern: UUID_PATTERN, description: 'Student UUID' }),
  assessmentItemId: Type.String({ pattern: UUID_PATTERN, description: 'Assessment item UUID' }),
  score: Type.Number({ description: 'Score value (must be within grading scheme range)' }),
});

export type EnterSingleResultInput = Static<typeof EnterSingleResultSchema>;

/**
 * Schema for bulk result entry (data grid interface).
 * Requirement 8.8: Up to 5000 result rows per operation.
 */
export const BulkResultEntrySchema = Type.Object({
  subjectId: Type.String({ pattern: UUID_PATTERN, description: 'Subject UUID' }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
  results: Type.Array(ResultEntryItemSchema, {
    minItems: 1,
    maxItems: 5000,
    description: 'Result entries (max 5000 per operation)',
  }),
});

export type BulkResultEntryInput = Static<typeof BulkResultEntrySchema>;

// ─── Row-Level Validation Error ──────────────────────────────────────────────

/**
 * A validation error for a specific row in a bulk operation.
 * Requirement 8.5, 8.8: Row-level validation errors.
 */
export const RowValidationErrorSchema = Type.Object({
  row: Type.Number({ description: 'Row index (0-based)' }),
  studentId: Type.String({ description: 'Student UUID for the row' }),
  assessmentItemId: Type.String({ description: 'Assessment item UUID for the row' }),
  field: Type.String({ description: 'Field that failed validation' }),
  message: Type.String({ description: 'Error message describing the issue' }),
});

export type RowValidationError = Static<typeof RowValidationErrorSchema>;

// ─── Result Response Schemas ─────────────────────────────────────────────────

/**
 * Response for a single result entry.
 */
export const ResultEntryResponseSchema = Type.Object({
  id: Type.String({ description: 'Result UUID' }),
  studentId: Type.String({ description: 'Student UUID' }),
  assessmentItemId: Type.String({ description: 'Assessment item UUID' }),
  score: Type.Number({ description: 'Entered score' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type ResultEntryResponse = Static<typeof ResultEntryResponseSchema>;

/**
 * Response for bulk result entry.
 * Includes successfully imported rows and row-level errors.
 */
export const BulkResultEntryResponseSchema = Type.Object({
  totalRows: Type.Number({ description: 'Total number of rows submitted' }),
  successCount: Type.Number({ description: 'Number of rows successfully imported' }),
  errorCount: Type.Number({ description: 'Number of rows with validation errors' }),
  results: Type.Array(ResultEntryResponseSchema, { description: 'Successfully imported results' }),
  errors: Type.Array(RowValidationErrorSchema, { description: 'Row-level validation errors' }),
});

export type BulkResultEntryResponse = Static<typeof BulkResultEntryResponseSchema>;

/**
 * Item score detail in a student subject result.
 */
export const ItemScoreDetailSchema = Type.Object({
  assessmentItemId: Type.String({ description: 'Assessment item UUID' }),
  itemName: Type.String({ description: 'Assessment item name' }),
  score: Type.Number({ description: 'Raw score' }),
  maxScore: Type.Number({ description: 'Maximum possible score' }),
  weight: Type.Number({ description: 'Item weight (percentage)' }),
  weightedScore: Type.Number({ description: 'Weighted contribution to average' }),
});

export type ItemScoreDetail = Static<typeof ItemScoreDetailSchema>;

/**
 * Calculated result for a student in a subject.
 */
export const StudentSubjectResultResponseSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  subjectId: Type.String({ description: 'Subject UUID' }),
  academicPeriodId: Type.String({ description: 'Academic period UUID' }),
  itemScores: Type.Array(ItemScoreDetailSchema, { description: 'Individual item scores' }),
  weightedAverage: Type.Number({ description: 'Weighted average score' }),
  grade: Type.String({ description: 'Assigned grade' }),
  gradeDescriptor: Type.Union([Type.String(), Type.Null()], { description: 'Grade descriptor' }),
});

export type StudentSubjectResultResponse = Static<typeof StudentSubjectResultResponseSchema>;

/**
 * Query parameters for getting student results.
 */
export const StudentResultsQuerySchema = Type.Object({
  subjectId: Type.String({ pattern: UUID_PATTERN, description: 'Subject UUID' }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
  studentId: Type.Optional(
    Type.String({
      pattern: UUID_PATTERN,
      description: 'Student UUID (optional, returns all students if omitted)',
    }),
  ),
});

export type StudentResultsQuery = Static<typeof StudentResultsQuerySchema>;

/**
 * Maximum number of result rows per bulk operation.
 */
export const MAX_BULK_RESULT_ROWS = 5000;
