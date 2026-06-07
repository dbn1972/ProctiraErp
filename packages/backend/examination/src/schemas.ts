/**
 * Typebox schemas for Examination Service request/response validation.
 *
 * Defines schemas for:
 * - CreateExamination (body)
 * - UpdateExamination (body)
 * - ExaminationResponse (response)
 * - ExaminationListQuery (querystring)
 * - Subject, Center, Session, GradingScheme sub-schemas
 *
 * Requirements:
 * - 10.1: Examination CRUD with subjects (min 1), centers (min 1), sessions, scheduling
 *         with exam dates at least 7 days in the future
 * - 10.7: Support 1–10 grading schemes per examination with minimum pass thresholds
 */
import { Type, type Static } from '@sinclair/typebox';

// UUID pattern for validation
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ISO date pattern (YYYY-MM-DD)
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

// Time pattern (HH:MM)
const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';

/**
 * Grade threshold schema for grading schemes.
 */
export const GradeThresholdSchema = Type.Object({
  grade: Type.String({ minLength: 1, maxLength: 10, description: 'Grade label (e.g., A, B, Pass)' }),
  minScore: Type.Number({ minimum: 0, description: 'Minimum score for this grade' }),
  maxScore: Type.Number({ minimum: 0, description: 'Maximum score for this grade' }),
  descriptor: Type.Optional(Type.String({ maxLength: 255, description: 'Grade descriptor' })),
});

export type GradeThresholdInput = Static<typeof GradeThresholdSchema>;

/**
 * Grading scheme schema for examination creation.
 */
export const ExaminationGradingSchemeSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Grading scheme name' }),
  minScore: Type.Number({ minimum: 0, description: 'Minimum possible score' }),
  maxScore: Type.Number({ minimum: 1, description: 'Maximum possible score' }),
  passThreshold: Type.Number({ minimum: 0, description: 'Minimum score to pass' }),
  thresholds: Type.Array(GradeThresholdSchema, {
    minItems: 1,
    description: 'Grade threshold definitions',
  }),
});

export type ExaminationGradingSchemeInput = Static<typeof ExaminationGradingSchemeSchema>;

/**
 * Subject schema for examination creation.
 */
export const ExaminationSubjectSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Subject name' }),
  code: Type.String({ minLength: 1, maxLength: 50, description: 'Subject code' }),
  maxScore: Type.Number({ minimum: 1, description: 'Maximum score for this subject' }),
  gradingSchemeId: Type.Optional(Type.String({
    pattern: UUID_PATTERN,
    description: 'Associated grading scheme UUID (references a scheme in the same examination)',
  })),
});

export type ExaminationSubjectInput = Static<typeof ExaminationSubjectSchema>;

/**
 * Center schema for examination creation.
 */
export const ExaminationCenterSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Center name' }),
  code: Type.String({ minLength: 1, maxLength: 50, description: 'Center code' }),
  institutionId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Institution UUID hosting this center',
  }),
  capacity: Type.Number({ minimum: 1, maximum: 99999, description: 'Seating capacity' }),
});

export type ExaminationCenterInput = Static<typeof ExaminationCenterSchema>;

/**
 * Session schema for examination scheduling.
 */
export const ExaminationSessionSchema = Type.Object({
  subjectId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Subject UUID for this session',
  }),
  date: Type.String({ pattern: DATE_PATTERN, description: 'Session date (YYYY-MM-DD)' }),
  startTime: Type.String({ pattern: TIME_PATTERN, description: 'Start time (HH:MM)' }),
  endTime: Type.String({ pattern: TIME_PATTERN, description: 'End time (HH:MM)' }),
  centerId: Type.Optional(Type.String({
    pattern: UUID_PATTERN,
    description: 'Specific center UUID for this session (optional)',
  })),
});

export type ExaminationSessionInput = Static<typeof ExaminationSessionSchema>;

/**
 * Schema for creating a new examination.
 *
 * Requirement 10.1: minimum 1 subject, minimum 1 center, dates at least 7 days in future
 * Requirement 10.7: 1–10 grading schemes with pass thresholds
 */
export const CreateExaminationSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Examination name' }),
  code: Type.String({ minLength: 1, maxLength: 50, description: 'Unique examination code' }),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Examination description' })),
  academicPeriodId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Academic period UUID',
  }),
  startDate: Type.String({ pattern: DATE_PATTERN, description: 'Examination start date (YYYY-MM-DD)' }),
  endDate: Type.String({ pattern: DATE_PATTERN, description: 'Examination end date (YYYY-MM-DD)' }),
  subjects: Type.Array(ExaminationSubjectSchema, {
    minItems: 1,
    description: 'Examination subjects (minimum 1 required)',
  }),
  centers: Type.Array(ExaminationCenterSchema, {
    minItems: 1,
    description: 'Examination centers (minimum 1 required)',
  }),
  sessions: Type.Optional(Type.Array(ExaminationSessionSchema, {
    description: 'Examination sessions (scheduling)',
  })),
  gradingSchemes: Type.Array(ExaminationGradingSchemeSchema, {
    minItems: 1,
    maxItems: 10,
    description: 'Grading schemes (1–10 per examination)',
  }),
});

export type CreateExaminationInput = Static<typeof CreateExaminationSchema>;

/**
 * Schema for updating an existing examination.
 * All fields are optional — only provided fields are updated.
 */
export const UpdateExaminationSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Examination name' })),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 50, description: 'Unique examination code' })),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Examination description' })),
  academicPeriodId: Type.Optional(Type.String({
    pattern: UUID_PATTERN,
    description: 'Academic period UUID',
  })),
  startDate: Type.Optional(Type.String({ pattern: DATE_PATTERN, description: 'Examination start date (YYYY-MM-DD)' })),
  endDate: Type.Optional(Type.String({ pattern: DATE_PATTERN, description: 'Examination end date (YYYY-MM-DD)' })),
  subjects: Type.Optional(Type.Array(ExaminationSubjectSchema, {
    minItems: 1,
    description: 'Examination subjects (minimum 1 required)',
  })),
  centers: Type.Optional(Type.Array(ExaminationCenterSchema, {
    minItems: 1,
    description: 'Examination centers (minimum 1 required)',
  })),
  sessions: Type.Optional(Type.Array(ExaminationSessionSchema, {
    description: 'Examination sessions (scheduling)',
  })),
  gradingSchemes: Type.Optional(Type.Array(ExaminationGradingSchemeSchema, {
    minItems: 1,
    maxItems: 10,
    description: 'Grading schemes (1–10 per examination)',
  })),
  status: Type.Optional(Type.Union([
    Type.Literal('DRAFT'),
    Type.Literal('SCHEDULED'),
    Type.Literal('IN_PROGRESS'),
    Type.Literal('COMPLETED'),
    Type.Literal('CANCELLED'),
  ], { description: 'Examination status' })),
});

export type UpdateExaminationInput = Static<typeof UpdateExaminationSchema>;

/**
 * Schema for examination list query parameters.
 */
export const ExaminationListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' })),
  academicPeriodId: Type.Optional(Type.String({ description: 'Filter by academic period ID' })),
  status: Type.Optional(Type.String({
    enum: ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    description: 'Filter by status',
  })),
  search: Type.Optional(Type.String({ description: 'Search by name or code' })),
  sortBy: Type.Optional(Type.String({ enum: ['name', 'code', 'startDate', 'createdAt'], default: 'name', description: 'Sort field' })),
  sortOrder: Type.Optional(Type.String({ enum: ['asc', 'desc'], default: 'asc', description: 'Sort direction' })),
});

export type ExaminationListQuery = Static<typeof ExaminationListQuerySchema>;

/**
 * Schema for examination ID path parameter.
 */
export const ExaminationParamsSchema = Type.Object({
  id: Type.String({
    pattern: UUID_PATTERN,
    description: 'Examination UUID',
  }),
});

export type ExaminationParams = Static<typeof ExaminationParamsSchema>;

/**
 * Schema for examination response object.
 */
export const ExaminationResponseSchema = Type.Object({
  id: Type.String({ description: 'Examination UUID' }),
  name: Type.String({ description: 'Examination name' }),
  code: Type.String({ description: 'Unique examination code' }),
  description: Type.Union([Type.String(), Type.Null()], { description: 'Examination description' }),
  academicPeriodId: Type.String({ description: 'Academic period UUID' }),
  startDate: Type.String({ description: 'Examination start date (YYYY-MM-DD)' }),
  endDate: Type.String({ description: 'Examination end date (YYYY-MM-DD)' }),
  status: Type.String({ description: 'Examination status' }),
  subjects: Type.Array(Type.Object({
    id: Type.String(),
    name: Type.String(),
    code: Type.String(),
    maxScore: Type.Number(),
    gradingSchemeId: Type.Optional(Type.String()),
  })),
  centers: Type.Array(Type.Object({
    id: Type.String(),
    name: Type.String(),
    code: Type.String(),
    institutionId: Type.String(),
    capacity: Type.Number(),
  })),
  sessions: Type.Array(Type.Object({
    id: Type.String(),
    subjectId: Type.String(),
    date: Type.String(),
    startTime: Type.String(),
    endTime: Type.String(),
    centerId: Type.Optional(Type.String()),
  })),
  gradingSchemes: Type.Array(Type.Object({
    id: Type.String(),
    name: Type.String(),
    minScore: Type.Number(),
    maxScore: Type.Number(),
    passThreshold: Type.Number(),
    thresholds: Type.Array(GradeThresholdSchema),
  })),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type ExaminationResponse = Static<typeof ExaminationResponseSchema>;

/**
 * Schema for paginated examination list response.
 */
export const ExaminationListResponseSchema = Type.Object({
  data: Type.Array(ExaminationResponseSchema),
  meta: Type.Object({
    page: Type.Number({ description: 'Current page number' }),
    pageSize: Type.Number({ description: 'Items per page' }),
    totalItems: Type.Number({ description: 'Total number of items' }),
    totalPages: Type.Number({ description: 'Total number of pages' }),
  }),
});

export type ExaminationListResponse = Static<typeof ExaminationListResponseSchema>;

/**
 * Schema for candidate registration request.
 *
 * Requirement 10.2: Validate eligibility by verifying active enrollment status
 *                   and completion of all prerequisite subjects
 * Requirement 10.3: Reject ineligible candidates with error indicating which
 *                   eligibility conditions were not met
 */
export const RegisterCandidateSchema = Type.Object({
  studentId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Student UUID to register as candidate',
  }),
  centerId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Examination center UUID for the candidate',
  }),
  subjectIds: Type.Array(
    Type.String({ pattern: UUID_PATTERN }),
    {
      minItems: 1,
      description: 'Subject UUIDs the candidate is registering for',
    },
  ),
});

export type RegisterCandidateInput = Static<typeof RegisterCandidateSchema>;

/**
 * Schema for candidate registration response.
 */
export const CandidateRegistrationResponseSchema = Type.Object({
  id: Type.String({ description: 'Registration UUID' }),
  examinationId: Type.String({ description: 'Examination UUID' }),
  studentId: Type.String({ description: 'Student UUID' }),
  centerId: Type.String({ description: 'Center UUID' }),
  subjectIds: Type.Array(Type.String(), { description: 'Registered subject UUIDs' }),
  status: Type.String({ description: 'Registration status' }),
  registeredAt: Type.String({ description: 'Registration timestamp (ISO 8601)' }),
});

export type CandidateRegistrationResponse = Static<typeof CandidateRegistrationResponseSchema>;
