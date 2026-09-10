/**
 * Typebox schemas for Staff Assignment request/response validation.
 *
 * Requirements:
 * - 7.2: Assignments with institution, subject, class, start/end dates
 * - 7.5: Allocation percentage per assignment, total ≤ 100%
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
 * Schema for creating a new staff assignment.
 */
export const CreateAssignmentSchema = Type.Object({
  staffId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Staff member UUID',
  }),
  institutionId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Institution UUID',
  }),
  subjectId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Subject UUID',
  }),
  classId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Class UUID',
  }),
  role: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Role in this assignment (e.g., Teacher, Assistant)',
  }),
  allocationPercentage: Type.Number({
    minimum: 1,
    maximum: 100,
    description: 'Time allocation percentage (1-100)',
  }),
  startDate: Type.String({
    pattern: DATE_PATTERN,
    description: 'Assignment start date (YYYY-MM-DD)',
  }),
  endDate: Type.Optional(
    Type.String({
      pattern: DATE_PATTERN,
      description: 'Assignment end date (YYYY-MM-DD), null for ongoing',
    }),
  ),
});

export type CreateAssignmentInput = Static<typeof CreateAssignmentSchema>;

/**
 * Schema for updating an existing staff assignment.
 */
export const UpdateAssignmentSchema = Type.Object({
  role: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 100,
      description: 'Role in this assignment',
    }),
  ),
  allocationPercentage: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 100,
      description: 'Time allocation percentage (1-100)',
    }),
  ),
  startDate: Type.Optional(
    Type.String({
      pattern: DATE_PATTERN,
      description: 'Assignment start date (YYYY-MM-DD)',
    }),
  ),
  endDate: Type.Optional(
    Type.Union([Type.String({ pattern: DATE_PATTERN }), Type.Null()], {
      description: 'Assignment end date (YYYY-MM-DD) or null for ongoing',
    }),
  ),
  status: Type.Optional(
    Type.String({
      enum: ['ACTIVE', 'INACTIVE'],
      description: 'Assignment status',
    }),
  ),
});

export type UpdateAssignmentInput = Static<typeof UpdateAssignmentSchema>;

/**
 * Schema for assignment list query parameters.
 */
export const AssignmentListQuerySchema = Type.Object({
  page: Type.Optional(
    Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' }),
  ),
  pageSize: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' }),
  ),
  staffId: Type.Optional(Type.String({ pattern: UUID_PATTERN, description: 'Filter by staff ID' })),
  institutionId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Filter by institution ID' }),
  ),
  subjectId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Filter by subject ID' }),
  ),
  classId: Type.Optional(Type.String({ pattern: UUID_PATTERN, description: 'Filter by class ID' })),
  status: Type.Optional(
    Type.String({ enum: ['ACTIVE', 'INACTIVE'], description: 'Filter by status' }),
  ),
});

export type AssignmentListQuery = Static<typeof AssignmentListQuerySchema>;

/**
 * Schema for assignment ID path parameter.
 */
export const AssignmentParamsSchema = Type.Object({
  id: Type.String({
    pattern: UUID_PATTERN,
    description: 'Assignment UUID',
  }),
});

export type AssignmentParams = Static<typeof AssignmentParamsSchema>;

/**
 * Schema for assignment response object.
 */
export const AssignmentResponseSchema = Type.Object({
  id: Type.String({ description: 'Assignment UUID' }),
  staffId: Type.String({ description: 'Staff member UUID' }),
  institutionId: Type.String({ description: 'Institution UUID' }),
  subjectId: Type.String({ description: 'Subject UUID' }),
  classId: Type.String({ description: 'Class UUID' }),
  role: Type.String({ description: 'Role in this assignment' }),
  allocationPercentage: Type.Number({ description: 'Time allocation percentage' }),
  startDate: Type.String({ description: 'Assignment start date (YYYY-MM-DD)' }),
  endDate: Type.Union([Type.String(), Type.Null()], { description: 'Assignment end date or null' }),
  status: Type.String({ description: 'Assignment status (ACTIVE or INACTIVE)' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type AssignmentResponse = Static<typeof AssignmentResponseSchema>;

/**
 * Schema for paginated assignment list response.
 */
export const AssignmentListResponseSchema = Type.Object({
  data: Type.Array(AssignmentResponseSchema),
  meta: Type.Object({
    page: Type.Number({ description: 'Current page number' }),
    pageSize: Type.Number({ description: 'Items per page' }),
    totalItems: Type.Number({ description: 'Total number of items' }),
    totalPages: Type.Number({ description: 'Total number of pages' }),
  }),
});

export type AssignmentListResponse = Static<typeof AssignmentListResponseSchema>;
