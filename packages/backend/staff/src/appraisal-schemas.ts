/**
 * Typebox schemas for Staff Appraisal request/response validation.
 *
 * Requirements:
 * - 7.3: Staff appraisal workflows with configurable criteria, scoring on a defined numeric scale,
 *         and approval chains routed through the Workflow_Engine
 */
import { Type, type Static } from '@sinclair/typebox';

/**
 * UUID pattern for validation.
 */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/**
 * ISO date pattern (YYYY-MM-DD).
 */
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

/**
 * Appraisal status values.
 */
export enum AppraisalStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * Schema for an appraisal criterion definition.
 */
export const AppraisalCriterionSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200, description: 'Criterion name' }),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Criterion description' })),
  weight: Type.Number({
    minimum: 0,
    maximum: 100,
    description: 'Weight percentage for this criterion',
  }),
  maxScore: Type.Number({
    minimum: 1,
    maximum: 100,
    description: 'Maximum score for this criterion',
  }),
});

export type AppraisalCriterionInput = Static<typeof AppraisalCriterionSchema>;

/**
 * Schema for creating an appraisal template (configurable criteria).
 */
export const CreateAppraisalTemplateSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200, description: 'Template name' }),
  description: Type.Optional(Type.String({ maxLength: 500, description: 'Template description' })),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
  criteria: Type.Array(AppraisalCriterionSchema, {
    minItems: 1,
    maxItems: 50,
    description: 'Appraisal criteria with weights summing to 100',
  }),
  scoreMin: Type.Number({ minimum: 0, description: 'Minimum score on the numeric scale' }),
  scoreMax: Type.Number({ minimum: 1, description: 'Maximum score on the numeric scale' }),
});

export type CreateAppraisalTemplateInput = Static<typeof CreateAppraisalTemplateSchema>;

/**
 * Schema for a score entry on a single criterion.
 */
export const AppraisalScoreEntrySchema = Type.Object({
  criterionName: Type.String({ minLength: 1, description: 'Name of the criterion being scored' }),
  score: Type.Number({ minimum: 0, description: 'Score awarded for this criterion' }),
  comment: Type.Optional(
    Type.String({ maxLength: 500, description: 'Comment for this criterion' }),
  ),
});

export type AppraisalScoreEntry = Static<typeof AppraisalScoreEntrySchema>;

/**
 * Schema for creating a staff appraisal.
 */
export const CreateAppraisalSchema = Type.Object({
  staffId: Type.String({ pattern: UUID_PATTERN, description: 'Staff member UUID' }),
  templateId: Type.String({ pattern: UUID_PATTERN, description: 'Appraisal template UUID' }),
  appraisalDate: Type.String({ pattern: DATE_PATTERN, description: 'Appraisal date (YYYY-MM-DD)' }),
  scores: Type.Array(AppraisalScoreEntrySchema, {
    minItems: 1,
    description: 'Scores for each criterion',
  }),
  overallComment: Type.Optional(
    Type.String({ maxLength: 1000, description: 'Overall appraisal comment' }),
  ),
});

export type CreateAppraisalInput = Static<typeof CreateAppraisalSchema>;

/**
 * Schema for submitting an appraisal for workflow approval.
 */
export const SubmitAppraisalSchema = Type.Object({
  comment: Type.Optional(Type.String({ maxLength: 500, description: 'Submission comment' })),
});

export type SubmitAppraisalInput = Static<typeof SubmitAppraisalSchema>;

/**
 * Schema for appraisal ID path parameter.
 */
export const AppraisalParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN, description: 'Appraisal UUID' }),
});

export type AppraisalParams = Static<typeof AppraisalParamsSchema>;

/**
 * Schema for appraisal template ID path parameter.
 */
export const AppraisalTemplateParamsSchema = Type.Object({
  templateId: Type.String({ pattern: UUID_PATTERN, description: 'Appraisal template UUID' }),
});

export type AppraisalTemplateParams = Static<typeof AppraisalTemplateParamsSchema>;

/**
 * Schema for appraisal list query parameters.
 */
export const AppraisalListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  staffId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Filter by staff member' }),
  ),
  templateId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Filter by template' }),
  ),
  status: Type.Optional(
    Type.String({
      enum: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'],
      description: 'Filter by status',
    }),
  ),
});

export type AppraisalListQuery = Static<typeof AppraisalListQuerySchema>;

/**
 * Schema for appraisal response object.
 */
export const AppraisalResponseSchema = Type.Object({
  id: Type.String(),
  staffId: Type.String(),
  templateId: Type.String(),
  appraisalDate: Type.String(),
  scores: Type.Array(
    Type.Object({
      criterionName: Type.String(),
      score: Type.Number(),
      comment: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
  totalScore: Type.Number(),
  overallComment: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  workflowInstanceId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type AppraisalResponse = Static<typeof AppraisalResponseSchema>;

/**
 * Schema for appraisal template response object.
 */
export const AppraisalTemplateResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  academicPeriodId: Type.String(),
  criteria: Type.Array(
    Type.Object({
      name: Type.String(),
      description: Type.Union([Type.String(), Type.Null()]),
      weight: Type.Number(),
      maxScore: Type.Number(),
    }),
  ),
  scoreMin: Type.Number(),
  scoreMax: Type.Number(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type AppraisalTemplateResponse = Static<typeof AppraisalTemplateResponseSchema>;
