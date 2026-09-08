/**
 * Typebox schemas for Report Card generation.
 *
 * Defines schemas for:
 * - Report card template CRUD
 * - Teacher comment management
 * - Report card generation requests
 * - Job status tracking
 *
 * Requirements: 8.7
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── UUID Pattern ────────────────────────────────────────────────────────────

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ─── Report Card Template Schemas ────────────────────────────────────────────

/**
 * Schema for creating a report card template.
 */
export const CreateReportCardTemplateSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Template name' }),
  templateContent: Type.String({ minLength: 1, description: 'HTML/Handlebars template content' }),
  isDefault: Type.Optional(
    Type.Boolean({ description: 'Whether this is the default template', default: false }),
  ),
  includeLogo: Type.Optional(
    Type.Boolean({ description: 'Include institution logo', default: true }),
  ),
  includeGradeSummary: Type.Optional(
    Type.Boolean({ description: 'Include overall grade summary', default: true }),
  ),
  includeComments: Type.Optional(
    Type.Boolean({ description: 'Include teacher comments', default: true }),
  ),
});

export type CreateReportCardTemplateInput = Static<typeof CreateReportCardTemplateSchema>;

/**
 * Schema for updating a report card template.
 */
export const UpdateReportCardTemplateSchema = Type.Partial(CreateReportCardTemplateSchema);

export type UpdateReportCardTemplateInput = Static<typeof UpdateReportCardTemplateSchema>;

/**
 * Schema for template ID parameter.
 */
export const ReportCardTemplateParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN, description: 'Template UUID' }),
});

export type ReportCardTemplateParams = Static<typeof ReportCardTemplateParamsSchema>;

/**
 * Response schema for a report card template.
 */
export const ReportCardTemplateResponseSchema = Type.Object({
  id: Type.String({ description: 'Template UUID' }),
  tenantId: Type.String({ description: 'Tenant UUID' }),
  name: Type.String({ description: 'Template name' }),
  templateContent: Type.String({ description: 'Template content' }),
  isDefault: Type.Boolean({ description: 'Whether this is the default template' }),
  includeLogo: Type.Boolean({ description: 'Include institution logo' }),
  includeGradeSummary: Type.Boolean({ description: 'Include overall grade summary' }),
  includeComments: Type.Boolean({ description: 'Include teacher comments' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type ReportCardTemplateResponse = Static<typeof ReportCardTemplateResponseSchema>;

// ─── Teacher Comment Schemas ─────────────────────────────────────────────────

/** Maximum length for teacher comments */
export const MAX_COMMENT_LENGTH = 500;

/**
 * Schema for creating/updating a teacher comment.
 * Requirement 8.7: Teacher comments up to 500 characters per subject.
 */
export const UpsertTeacherCommentSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN, description: 'Student UUID' }),
  subjectId: Type.String({ pattern: UUID_PATTERN, description: 'Subject UUID' }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
  teacherId: Type.String({ pattern: UUID_PATTERN, description: 'Teacher (staff) UUID' }),
  comment: Type.String({
    minLength: 1,
    maxLength: MAX_COMMENT_LENGTH,
    description: `Teacher comment (max ${MAX_COMMENT_LENGTH} characters)`,
  }),
});

export type UpsertTeacherCommentInput = Static<typeof UpsertTeacherCommentSchema>;

/**
 * Response schema for a teacher comment.
 */
export const TeacherCommentResponseSchema = Type.Object({
  id: Type.String({ description: 'Comment UUID' }),
  studentId: Type.String({ description: 'Student UUID' }),
  subjectId: Type.String({ description: 'Subject UUID' }),
  academicPeriodId: Type.String({ description: 'Academic period UUID' }),
  teacherId: Type.String({ description: 'Teacher UUID' }),
  comment: Type.String({ description: 'Comment text' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type TeacherCommentResponse = Static<typeof TeacherCommentResponseSchema>;

/**
 * Query parameters for getting teacher comments.
 */
export const TeacherCommentsQuerySchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN, description: 'Student UUID' }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
});

export type TeacherCommentsQuery = Static<typeof TeacherCommentsQuerySchema>;

// ─── Report Card Generation Schemas ──────────────────────────────────────────

/**
 * Schema for requesting report card generation.
 * Requirement 8.7: Generate report cards as PDF using configurable templates.
 */
export const GenerateReportCardSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN, description: 'Student UUID' }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
  templateId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Template UUID (uses default if omitted)' }),
  ),
  institutionId: Type.String({ pattern: UUID_PATTERN, description: 'Institution UUID' }),
});

export type GenerateReportCardInput = Static<typeof GenerateReportCardSchema>;

/**
 * Schema for bulk report card generation (multiple students).
 */
export const BulkGenerateReportCardSchema = Type.Object({
  studentIds: Type.Array(Type.String({ pattern: UUID_PATTERN }), {
    minItems: 1,
    maxItems: 500,
    description: 'Student UUIDs (max 500 per batch)',
  }),
  academicPeriodId: Type.String({ pattern: UUID_PATTERN, description: 'Academic period UUID' }),
  templateId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Template UUID (uses default if omitted)' }),
  ),
  institutionId: Type.String({ pattern: UUID_PATTERN, description: 'Institution UUID' }),
});

export type BulkGenerateReportCardInput = Static<typeof BulkGenerateReportCardSchema>;

/**
 * Report card job status enum.
 */
export const ReportCardJobStatusEnum = Type.Union([
  Type.Literal('queued'),
  Type.Literal('processing'),
  Type.Literal('completed'),
  Type.Literal('failed'),
]);

/**
 * Response schema for a report card generation job.
 */
export const ReportCardJobResponseSchema = Type.Object({
  id: Type.String({ description: 'Job UUID' }),
  studentId: Type.String({ description: 'Student UUID' }),
  academicPeriodId: Type.String({ description: 'Academic period UUID' }),
  templateId: Type.String({ description: 'Template UUID' }),
  institutionId: Type.String({ description: 'Institution UUID' }),
  status: ReportCardJobStatusEnum,
  errorMessage: Type.Union([Type.String(), Type.Null()], {
    description: 'Error message if failed',
  }),
  outputUrl: Type.Union([Type.String(), Type.Null()], { description: 'URL to generated PDF' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
  completedAt: Type.Union([Type.String(), Type.Null()], { description: 'Completion timestamp' }),
});

export type ReportCardJobResponse = Static<typeof ReportCardJobResponseSchema>;

/**
 * Response schema for bulk generation request.
 */
export const BulkGenerateReportCardResponseSchema = Type.Object({
  totalStudents: Type.Number({ description: 'Total students requested' }),
  jobsCreated: Type.Number({ description: 'Number of jobs queued' }),
  jobs: Type.Array(ReportCardJobResponseSchema, { description: 'Created job records' }),
});

export type BulkGenerateReportCardResponse = Static<typeof BulkGenerateReportCardResponseSchema>;

/**
 * Job ID parameter schema.
 */
export const ReportCardJobParamsSchema = Type.Object({
  jobId: Type.String({ pattern: UUID_PATTERN, description: 'Job UUID' }),
});

export type ReportCardJobParams = Static<typeof ReportCardJobParamsSchema>;
