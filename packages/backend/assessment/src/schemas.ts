/**
 * Typebox schemas for Assessment Service request/response validation.
 *
 * Defines schemas for:
 * - GradingScheme CRUD (numeric, letter, competency)
 * - AssessmentItem definition with weight validation
 * - Outcome-based assessment mapping
 *
 * Requirements: 8.1, 8.2, 8.3, 8.6
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── UUID Pattern ────────────────────────────────────────────────────────────

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ─── Grading Scheme Schemas ──────────────────────────────────────────────────

/**
 * Grading scheme types supported by the platform.
 * - numeric: Score-based with configurable min/max
 * - letter: Letter grades with threshold boundaries
 * - competency: Proficiency levels with descriptors
 */
export const GradingSchemeTypeEnum = Type.Union([
  Type.Literal('numeric'),
  Type.Literal('letter'),
  Type.Literal('competency'),
]);

export type GradingSchemeType = Static<typeof GradingSchemeTypeEnum>;

/**
 * A grade threshold defines the score range for a particular grade.
 */
export const GradeThresholdSchema = Type.Object({
  grade: Type.String({
    minLength: 1,
    maxLength: 10,
    description: 'Grade label (e.g., A, B, Proficient)',
  }),
  minScore: Type.Number({ description: 'Minimum score for this grade (inclusive)' }),
  maxScore: Type.Number({ description: 'Maximum score for this grade (inclusive)' }),
  descriptor: Type.Optional(
    Type.String({ maxLength: 500, description: 'Proficiency descriptor for competency grades' }),
  ),
});

export type GradeThreshold = Static<typeof GradeThresholdSchema>;

/**
 * Schema for creating a new grading scheme.
 * Requirement 8.1: Support numeric scores, letter grades, competency levels.
 */
export const CreateGradingSchemeSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Grading scheme name' }),
  type: GradingSchemeTypeEnum,
  minValue: Type.Number({ description: 'Minimum possible score' }),
  maxValue: Type.Number({ description: 'Maximum possible score' }),
  thresholds: Type.Array(GradeThresholdSchema, {
    minItems: 1,
    description: 'Grade thresholds defining score ranges',
  }),
});

export type CreateGradingSchemeInput = Static<typeof CreateGradingSchemeSchema>;

/**
 * Schema for updating a grading scheme.
 */
export const UpdateGradingSchemeSchema = Type.Object({
  name: Type.Optional(
    Type.String({ minLength: 1, maxLength: 255, description: 'Grading scheme name' }),
  ),
  type: Type.Optional(GradingSchemeTypeEnum),
  minValue: Type.Optional(Type.Number({ description: 'Minimum possible score' })),
  maxValue: Type.Optional(Type.Number({ description: 'Maximum possible score' })),
  thresholds: Type.Optional(
    Type.Array(GradeThresholdSchema, {
      minItems: 1,
      description: 'Grade thresholds defining score ranges',
    }),
  ),
});

export type UpdateGradingSchemeInput = Static<typeof UpdateGradingSchemeSchema>;

/**
 * Schema for grading scheme ID path parameter.
 */
export const GradingSchemeParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN, description: 'Grading scheme UUID' }),
});

export type GradingSchemeParams = Static<typeof GradingSchemeParamsSchema>;

/**
 * Schema for grading scheme response.
 */
export const GradingSchemeResponseSchema = Type.Object({
  id: Type.String({ description: 'Grading scheme UUID' }),
  tenantId: Type.String({ description: 'Tenant UUID' }),
  name: Type.String({ description: 'Grading scheme name' }),
  type: GradingSchemeTypeEnum,
  minValue: Type.Number({ description: 'Minimum possible score' }),
  maxValue: Type.Number({ description: 'Maximum possible score' }),
  thresholds: Type.Array(GradeThresholdSchema),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type GradingSchemeResponse = Static<typeof GradingSchemeResponseSchema>;

/**
 * Schema for grading scheme list query parameters.
 */
export const GradingSchemeListQuerySchema = Type.Object({
  page: Type.Optional(
    Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' }),
  ),
  pageSize: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
  ),
  type: Type.Optional(GradingSchemeTypeEnum),
  search: Type.Optional(Type.String({ description: 'Search by name' })),
});

export type GradingSchemeListQuery = Static<typeof GradingSchemeListQuerySchema>;

// ─── Assessment Item Schemas ─────────────────────────────────────────────────

/**
 * Schema for a single assessment item definition.
 * Requirement 8.2: Up to 50 items per subject per academic period, with percentage weighting.
 */
export const AssessmentItemSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Assessment item name' }),
  weight: Type.Number({
    minimum: 0.01,
    maximum: 100,
    description: 'Percentage weight (all items must sum to 100)',
  }),
  maxScore: Type.Number({ minimum: 0, description: 'Maximum score for this item' }),
  minScore: Type.Number({ minimum: 0, description: 'Minimum score for this item' }),
  outcomeIds: Type.Optional(
    Type.Array(Type.String({ pattern: UUID_PATTERN }), {
      description: 'Mapped curriculum outcome UUIDs',
    }),
  ),
});

export type AssessmentItemInput = Static<typeof AssessmentItemSchema>;

/**
 * Schema for defining assessment items for a subject in an academic period.
 * Requirement 8.2: All item weightings must sum to exactly 100%.
 * Requirement 8.2: Up to 50 items per subject per academic period.
 */
export const DefineAssessmentItemsSchema = Type.Object({
  subjectId: Type.String({ pattern: UUID_PATTERN, description: 'Subject UUID' }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
  gradingSchemeId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Grading scheme UUID to use',
  }),
  items: Type.Array(AssessmentItemSchema, {
    minItems: 1,
    maxItems: 50,
    description: 'Assessment items (max 50 per subject per period)',
  }),
});

export type DefineAssessmentItemsInput = Static<typeof DefineAssessmentItemsSchema>;

/**
 * Schema for assessment item response.
 */
export const AssessmentItemResponseSchema = Type.Object({
  id: Type.String({ description: 'Assessment item UUID' }),
  subjectId: Type.String({ description: 'Subject UUID' }),
  academicPeriodId: Type.String({ description: 'Academic period UUID' }),
  gradingSchemeId: Type.String({ description: 'Grading scheme UUID' }),
  name: Type.String({ description: 'Assessment item name' }),
  weight: Type.Number({ description: 'Percentage weight' }),
  maxScore: Type.Number({ description: 'Maximum score' }),
  minScore: Type.Number({ description: 'Minimum score' }),
  outcomeIds: Type.Array(Type.String(), { description: 'Mapped curriculum outcome UUIDs' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type AssessmentItemResponse = Static<typeof AssessmentItemResponseSchema>;

/**
 * Schema for assessment items list response.
 */
export const AssessmentItemsListResponseSchema = Type.Object({
  subjectId: Type.String({ description: 'Subject UUID' }),
  academicPeriodId: Type.String({ description: 'Academic period UUID' }),
  gradingSchemeId: Type.Union([Type.String(), Type.Null()], { description: 'Grading scheme UUID' }),
  totalWeight: Type.Number({ description: 'Sum of all item weights (should be 100)' }),
  items: Type.Array(AssessmentItemResponseSchema),
});

export type AssessmentItemsListResponse = Static<typeof AssessmentItemsListResponseSchema>;

/**
 * Schema for assessment items query parameters.
 */
export const AssessmentItemsQuerySchema = Type.Object({
  subjectId: Type.String({ pattern: UUID_PATTERN, description: 'Subject UUID' }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
});

export type AssessmentItemsQuery = Static<typeof AssessmentItemsQuerySchema>;

// ─── Outcome Mapping Schemas ─────────────────────────────────────────────────

/**
 * Schema for a curriculum outcome definition.
 * Requirement 8.6: Outcome-based assessment mapping.
 */
export const CreateOutcomeSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Outcome name' }),
  code: Type.String({ minLength: 1, maxLength: 50, description: 'Outcome code' }),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Outcome description' })),
  subjectId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Subject UUID this outcome belongs to',
  }),
});

export type CreateOutcomeInput = Static<typeof CreateOutcomeSchema>;

/**
 * Schema for outcome response.
 */
export const OutcomeResponseSchema = Type.Object({
  id: Type.String({ description: 'Outcome UUID' }),
  tenantId: Type.String({ description: 'Tenant UUID' }),
  name: Type.String({ description: 'Outcome name' }),
  code: Type.String({ description: 'Outcome code' }),
  description: Type.Union([Type.String(), Type.Null()], { description: 'Outcome description' }),
  subjectId: Type.String({ description: 'Subject UUID' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type OutcomeResponse = Static<typeof OutcomeResponseSchema>;

/**
 * Schema for outcome params.
 */
export const OutcomeParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN, description: 'Outcome UUID' }),
});

export type OutcomeParams = Static<typeof OutcomeParamsSchema>;
