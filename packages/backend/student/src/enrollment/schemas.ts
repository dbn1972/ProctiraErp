/**
 * Typebox schemas for Enrollment Service request/response validation.
 *
 * Defines schemas for:
 * - CreateEnrollment (body)
 * - UpdateEnrollmentStatus (body)
 * - StudentTransfer (body)
 * - EnrollmentResponse (response)
 * - EnrollmentHistoryResponse (response)
 * - TransferRecordResponse (response)
 *
 * Requirements: 6.2, 6.3, 6.4
 */
import { Type, type Static } from '@sinclair/typebox';

const UuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/**
 * Schema for creating a new enrollment.
 */
export const CreateEnrollmentSchema = Type.Object({
  studentId: Type.String({
    pattern: UuidPattern,
    description: 'Student UUID',
  }),
  institutionId: Type.String({
    pattern: UuidPattern,
    description: 'Institution UUID',
  }),
  gradeId: Type.String({
    pattern: UuidPattern,
    description: 'Grade UUID',
  }),
  classId: Type.Optional(Type.String({
    pattern: UuidPattern,
    description: 'Class UUID (optional)',
  })),
  academicPeriodId: Type.String({
    pattern: UuidPattern,
    description: 'Academic period UUID',
  }),
  enrolledAt: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Enrollment date (ISO date format YYYY-MM-DD)',
  }),
});

export type CreateEnrollmentInput = Static<typeof CreateEnrollmentSchema>;

/**
 * Schema for updating enrollment status (withdraw, graduate).
 */
export const UpdateEnrollmentStatusSchema = Type.Object({
  status: Type.Union([
    Type.Literal('WITHDRAWN'),
    Type.Literal('GRADUATED'),
  ], { description: 'New enrollment status' }),
  reason: Type.String({
    minLength: 1,
    maxLength: 500,
    description: 'Reason for status change',
  }),
  effectiveDate: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Effective date of status change (ISO date format YYYY-MM-DD)',
  }),
});

export type UpdateEnrollmentStatusInput = Static<typeof UpdateEnrollmentStatusSchema>;

/**
 * Schema for student transfer between institutions.
 * Requirements: 6.3, 6.4
 */
export const StudentTransferSchema = Type.Object({
  studentId: Type.String({
    pattern: UuidPattern,
    description: 'Student UUID',
  }),
  sourceEnrollmentId: Type.String({
    pattern: UuidPattern,
    description: 'Source enrollment UUID',
  }),
  destinationInstitutionId: Type.String({
    pattern: UuidPattern,
    description: 'Destination institution UUID',
  }),
  destinationGradeId: Type.String({
    pattern: UuidPattern,
    description: 'Grade at destination institution',
  }),
  destinationClassId: Type.Optional(Type.String({
    pattern: UuidPattern,
    description: 'Class at destination institution (optional)',
  })),
  academicPeriodId: Type.String({
    pattern: UuidPattern,
    description: 'Academic period UUID for the new enrollment',
  }),
  transferDate: Type.String({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Transfer date (ISO date format YYYY-MM-DD)',
  }),
  reason: Type.String({
    minLength: 1,
    maxLength: 500,
    description: 'Reason for transfer',
  }),
});

export type StudentTransferInput = Static<typeof StudentTransferSchema>;

/**
 * Schema for enrollment ID path parameter.
 */
export const EnrollmentParamsSchema = Type.Object({
  id: Type.String({
    pattern: UuidPattern,
    description: 'Enrollment UUID',
  }),
});

export type EnrollmentParams = Static<typeof EnrollmentParamsSchema>;

/**
 * Schema for student ID path parameter (for enrollment history).
 */
export const StudentParamsSchema = Type.Object({
  studentId: Type.String({
    pattern: UuidPattern,
    description: 'Student UUID',
  }),
});

export type StudentParams = Static<typeof StudentParamsSchema>;

/**
 * Schema for enrollment list query parameters.
 */
export const EnrollmentListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  studentId: Type.Optional(Type.String({ description: 'Filter by student ID' })),
  institutionId: Type.Optional(Type.String({ description: 'Filter by institution ID' })),
  academicPeriodId: Type.Optional(Type.String({ description: 'Filter by academic period ID' })),
  status: Type.Optional(Type.String({
    enum: ['ENROLLED', 'TRANSFERRED', 'WITHDRAWN', 'GRADUATED'],
    description: 'Filter by enrollment status',
  })),
});

export type EnrollmentListQuery = Static<typeof EnrollmentListQuerySchema>;

/**
 * Enrollment response schema.
 */
export const EnrollmentResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  studentId: Type.String(),
  institutionId: Type.String(),
  gradeId: Type.String(),
  classId: Type.Union([Type.String(), Type.Null()]),
  academicPeriodId: Type.String(),
  status: Type.String(),
  enrolledAt: Type.String(),
  exitedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type EnrollmentResponse = Static<typeof EnrollmentResponseSchema>;

/**
 * Enrollment history entry response schema.
 * Requirement 6.2: Record each status change as a history entry.
 */
export const EnrollmentHistoryEntrySchema = Type.Object({
  id: Type.String(),
  enrollmentId: Type.String(),
  previousStatus: Type.Union([Type.String(), Type.Null()]),
  newStatus: Type.String(),
  effectiveDate: Type.String(),
  institutionId: Type.String(),
  academicPeriodId: Type.String(),
  reason: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export type EnrollmentHistoryEntry = Static<typeof EnrollmentHistoryEntrySchema>;

/**
 * Transfer record response schema.
 * Requirement 6.3: Create a transfer record linking source and destination.
 */
export const TransferRecordResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  studentId: Type.String(),
  sourceInstitutionId: Type.String(),
  sourceEnrollmentId: Type.String(),
  destinationInstitutionId: Type.String(),
  destinationEnrollmentId: Type.String(),
  transferDate: Type.String(),
  reason: Type.String(),
  createdAt: Type.String(),
});

export type TransferRecordResponse = Static<typeof TransferRecordResponseSchema>;
