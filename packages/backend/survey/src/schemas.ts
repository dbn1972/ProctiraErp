/**
 * Typebox schemas for Survey Service request/response validation.
 *
 * Defines schemas for:
 * - Survey CRUD (create, update, list, get)
 * - Question types: text, number, date, dropdown, checkbox, table, repeater
 * - Survey distribution with area, type, classification filters
 * - Survey submission with required field and data type validation
 * - Completion tracking and reminders
 * - Response aggregation with cross-tabulation
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── UUID Pattern ────────────────────────────────────────────────────────────

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ─── Question Type Enum ──────────────────────────────────────────────────────

/**
 * Supported survey question types.
 * Requirement 23.1: text, number, date, dropdown, checkbox, table, repeater
 */
export const QuestionTypeEnum = Type.Union([
  Type.Literal('text'),
  Type.Literal('number'),
  Type.Literal('date'),
  Type.Literal('dropdown'),
  Type.Literal('checkbox'),
  Type.Literal('table'),
  Type.Literal('repeater'),
]);

export type QuestionType = Static<typeof QuestionTypeEnum>;

// ─── Survey Status Enum ──────────────────────────────────────────────────────

export const SurveyStatusEnum = Type.Union([
  Type.Literal('draft'),
  Type.Literal('published'),
  Type.Literal('closed'),
]);

export type SurveyStatus = Static<typeof SurveyStatusEnum>;

// ─── Completion Status Enum ──────────────────────────────────────────────────

export const CompletionStatusEnum = Type.Union([
  Type.Literal('pending'),
  Type.Literal('in_progress'),
  Type.Literal('completed'),
]);

export type CompletionStatus = Static<typeof CompletionStatusEnum>;

// ─── Dropdown Option Schema ──────────────────────────────────────────────────

export const DropdownOptionSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 255, description: 'Display label for the option' }),
  value: Type.String({ minLength: 1, maxLength: 255, description: 'Value stored when selected' }),
});

export type DropdownOption = Static<typeof DropdownOptionSchema>;

// ─── Table Column Schema ─────────────────────────────────────────────────────

export const TableColumnSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Column name' }),
  type: Type.Union([
    Type.Literal('text'),
    Type.Literal('number'),
    Type.Literal('date'),
    Type.Literal('dropdown'),
  ], { description: 'Column data type' }),
  required: Type.Optional(Type.Boolean({ default: false, description: 'Whether column is required' })),
  options: Type.Optional(Type.Array(DropdownOptionSchema, { description: 'Options for dropdown columns' })),
});

export type TableColumn = Static<typeof TableColumnSchema>;

// ─── Question Schema ─────────────────────────────────────────────────────────

/**
 * Schema for a survey question definition.
 * Requirement 23.1: Support configurable question types.
 */
export const QuestionSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 500, description: 'Question label/text' }),
  type: QuestionTypeEnum,
  required: Type.Optional(Type.Boolean({ default: false, description: 'Whether the question is required' })),
  order: Type.Number({ minimum: 0, description: 'Display order of the question' }),
  options: Type.Optional(Type.Array(DropdownOptionSchema, {
    description: 'Options for dropdown/checkbox questions',
  })),
  columns: Type.Optional(Type.Array(TableColumnSchema, {
    description: 'Column definitions for table questions',
  })),
  repeaterFields: Type.Optional(Type.Array(Type.Object({
    label: Type.String({ minLength: 1, maxLength: 255 }),
    type: Type.Union([
      Type.Literal('text'),
      Type.Literal('number'),
      Type.Literal('date'),
      Type.Literal('dropdown'),
    ]),
    required: Type.Optional(Type.Boolean({ default: false })),
    options: Type.Optional(Type.Array(DropdownOptionSchema)),
  }), { description: 'Field definitions for repeater questions' })),
  validation: Type.Optional(Type.Object({
    min: Type.Optional(Type.Number({ description: 'Minimum value for number questions' })),
    max: Type.Optional(Type.Number({ description: 'Maximum value for number questions' })),
    minLength: Type.Optional(Type.Number({ description: 'Minimum length for text questions' })),
    maxLength: Type.Optional(Type.Number({ description: 'Maximum length for text questions' })),
    pattern: Type.Optional(Type.String({ description: 'Regex pattern for text questions' })),
  })),
});

export type QuestionInput = Static<typeof QuestionSchema>;

// ─── Create Survey Schema ────────────────────────────────────────────────────

/**
 * Schema for creating a new survey.
 * Requirement 23.1: Creating surveys with configurable question types.
 */
export const CreateSurveySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Survey name' }),
  description: Type.Optional(Type.String({ maxLength: 2000, description: 'Survey description' })),
  academicPeriodId: Type.Optional(Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' })),
  startDate: Type.Optional(Type.String({ description: 'Survey start date (ISO 8601)' })),
  endDate: Type.Optional(Type.String({ description: 'Survey end date (ISO 8601)' })),
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    description: 'Survey questions (at least one required)',
  }),
});

export type CreateSurveyInput = Static<typeof CreateSurveySchema>;

// ─── Update Survey Schema ────────────────────────────────────────────────────

export const UpdateSurveySchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Survey name' })),
  description: Type.Optional(Type.String({ maxLength: 2000, description: 'Survey description' })),
  academicPeriodId: Type.Optional(Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' })),
  startDate: Type.Optional(Type.String({ description: 'Survey start date (ISO 8601)' })),
  endDate: Type.Optional(Type.String({ description: 'Survey end date (ISO 8601)' })),
  status: Type.Optional(SurveyStatusEnum),
  questions: Type.Optional(Type.Array(QuestionSchema, {
    minItems: 1,
    description: 'Survey questions',
  })),
});

export type UpdateSurveyInput = Static<typeof UpdateSurveySchema>;

// ─── Survey Params Schema ────────────────────────────────────────────────────

export const SurveyParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN, description: 'Survey UUID' }),
});

export type SurveyParams = Static<typeof SurveyParamsSchema>;

// ─── Survey List Query Schema ────────────────────────────────────────────────

export const SurveyListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' })),
  status: Type.Optional(SurveyStatusEnum),
  search: Type.Optional(Type.String({ description: 'Search by name' })),
});

export type SurveyListQuery = Static<typeof SurveyListQuerySchema>;

// ─── Survey Response Schema ──────────────────────────────────────────────────

export const QuestionResponseSchema = Type.Object({
  id: Type.String({ description: 'Question UUID' }),
  label: Type.String(),
  type: QuestionTypeEnum,
  required: Type.Boolean(),
  order: Type.Number(),
  options: Type.Optional(Type.Array(DropdownOptionSchema)),
  columns: Type.Optional(Type.Array(TableColumnSchema)),
  repeaterFields: Type.Optional(Type.Array(Type.Object({
    label: Type.String(),
    type: Type.String(),
    required: Type.Boolean(),
    options: Type.Optional(Type.Array(DropdownOptionSchema)),
  }))),
  validation: Type.Optional(Type.Object({
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Number()),
    minLength: Type.Optional(Type.Number()),
    maxLength: Type.Optional(Type.Number()),
    pattern: Type.Optional(Type.String()),
  })),
});

export const SurveyResponseSchema = Type.Object({
  id: Type.String({ description: 'Survey UUID' }),
  tenantId: Type.String({ description: 'Tenant UUID' }),
  name: Type.String({ description: 'Survey name' }),
  description: Type.Union([Type.String(), Type.Null()], { description: 'Survey description' }),
  status: SurveyStatusEnum,
  academicPeriodId: Type.Union([Type.String(), Type.Null()]),
  startDate: Type.Union([Type.String(), Type.Null()]),
  endDate: Type.Union([Type.String(), Type.Null()]),
  questions: Type.Array(QuestionResponseSchema),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type SurveyResponse = Static<typeof SurveyResponseSchema>;

// ─── Distribution Schemas ────────────────────────────────────────────────────

/**
 * Schema for distributing a survey to institutions.
 * Requirement 23.2: Distribute based on area, type, classification filters.
 */
export const DistributeSurveySchema = Type.Object({
  surveyId: Type.String({ pattern: UUID_PATTERN, description: 'Survey UUID to distribute' }),
  filters: Type.Object({
    areaIds: Type.Optional(Type.Array(Type.String({ pattern: UUID_PATTERN }), {
      description: 'Filter by area IDs',
    })),
    institutionTypeIds: Type.Optional(Type.Array(Type.String({ pattern: UUID_PATTERN }), {
      description: 'Filter by institution type IDs',
    })),
    classificationIds: Type.Optional(Type.Array(Type.String({ pattern: UUID_PATTERN }), {
      description: 'Filter by classification IDs',
    })),
  }),
  dueDate: Type.Optional(Type.String({ description: 'Due date for completion (ISO 8601)' })),
  reminderDays: Type.Optional(Type.Array(Type.Number({ minimum: 1 }), {
    description: 'Days before due date to send reminders',
  })),
});

export type DistributeSurveyInput = Static<typeof DistributeSurveySchema>;

// ─── Submission Schemas ──────────────────────────────────────────────────────

/**
 * Schema for submitting survey responses.
 * Requirement 23.3: Validate required fields and data type constraints.
 */
export const SubmitSurveySchema = Type.Object({
  surveyId: Type.String({ pattern: UUID_PATTERN, description: 'Survey UUID' }),
  institutionId: Type.String({ pattern: UUID_PATTERN, description: 'Institution UUID submitting the response' }),
  answers: Type.Array(Type.Object({
    questionId: Type.String({ pattern: UUID_PATTERN, description: 'Question UUID' }),
    value: Type.Unknown({ description: 'Answer value (type depends on question type)' }),
  }), { description: 'Array of question answers' }),
});

export type SubmitSurveyInput = Static<typeof SubmitSurveySchema>;

// ─── Completion Tracking Schemas ─────────────────────────────────────────────

/**
 * Schema for distribution record response.
 * Requirement 23.4: Track completion status per institution.
 */
export const DistributionRecordResponseSchema = Type.Object({
  id: Type.String({ description: 'Distribution record UUID' }),
  surveyId: Type.String(),
  institutionId: Type.String(),
  status: CompletionStatusEnum,
  dueDate: Type.Union([Type.String(), Type.Null()]),
  submittedAt: Type.Union([Type.String(), Type.Null()]),
  remindersSent: Type.Number(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type DistributionRecordResponse = Static<typeof DistributionRecordResponseSchema>;

// ─── Reminder Schema ─────────────────────────────────────────────────────────

export const SendReminderSchema = Type.Object({
  surveyId: Type.String({ pattern: UUID_PATTERN, description: 'Survey UUID' }),
  institutionIds: Type.Optional(Type.Array(Type.String({ pattern: UUID_PATTERN }), {
    description: 'Specific institution IDs to remind (all incomplete if omitted)',
  })),
});

export type SendReminderInput = Static<typeof SendReminderSchema>;

// ─── Aggregation Schemas ─────────────────────────────────────────────────────

/**
 * Schema for requesting survey response aggregation.
 * Requirement 23.5: Aggregate responses with cross-tabulation.
 */
export const AggregateResponsesQuerySchema = Type.Object({
  surveyId: Type.String({ pattern: UUID_PATTERN, description: 'Survey UUID' }),
  groupBy: Type.Optional(Type.Union([
    Type.Literal('area'),
    Type.Literal('institution_type'),
  ], { description: 'Cross-tabulation dimension' })),
});

export type AggregateResponsesQuery = Static<typeof AggregateResponsesQuerySchema>;

/**
 * Schema for aggregated response summary.
 */
export const AggregatedResponseSchema = Type.Object({
  surveyId: Type.String(),
  totalDistributed: Type.Number(),
  totalCompleted: Type.Number(),
  completionRate: Type.Number(),
  questionSummaries: Type.Array(Type.Object({
    questionId: Type.String(),
    questionLabel: Type.String(),
    questionType: QuestionTypeEnum,
    summary: Type.Unknown({ description: 'Aggregated data (varies by question type)' }),
  })),
  crossTabulation: Type.Optional(Type.Array(Type.Object({
    groupKey: Type.String(),
    groupLabel: Type.String(),
    totalDistributed: Type.Number(),
    totalCompleted: Type.Number(),
    completionRate: Type.Number(),
  }))),
});

export type AggregatedResponse = Static<typeof AggregatedResponseSchema>;
