/**
 * Typebox schemas for Staff Training Program request/response validation.
 *
 * Requirements:
 * - 7.4: Manage training programs, sessions, attendance, and certification tracking
 *         including certification expiry dates
 * - 7.8: Update certification status to expired and trigger notification on expiry
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
 * Certification status values.
 */
export enum CertificationStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

/**
 * Training session attendance status.
 */
export enum TrainingAttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  EXCUSED = 'EXCUSED',
}

/**
 * Schema for creating a training program.
 */
export const CreateTrainingProgramSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200, description: 'Training program name' }),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Program description' })),
  startDate: Type.String({ pattern: DATE_PATTERN, description: 'Program start date' }),
  endDate: Type.String({ pattern: DATE_PATTERN, description: 'Program end date' }),
  provider: Type.Optional(Type.String({ maxLength: 200, description: 'Training provider' })),
  certificationName: Type.Optional(Type.String({ maxLength: 200, description: 'Certification awarded on completion' })),
  certificationValidityDays: Type.Optional(Type.Number({
    minimum: 1,
    maximum: 36500,
    description: 'Number of days the certification is valid after issuance',
  })),
});

export type CreateTrainingProgramInput = Static<typeof CreateTrainingProgramSchema>;

/**
 * Schema for updating a training program.
 */
export const UpdateTrainingProgramSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  description: Type.Optional(Type.String({ maxLength: 1000 })),
  startDate: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
  endDate: Type.Optional(Type.String({ pattern: DATE_PATTERN })),
  provider: Type.Optional(Type.String({ maxLength: 200 })),
  certificationName: Type.Optional(Type.String({ maxLength: 200 })),
  certificationValidityDays: Type.Optional(Type.Number({ minimum: 1, maximum: 36500 })),
});

export type UpdateTrainingProgramInput = Static<typeof UpdateTrainingProgramSchema>;

/**
 * Schema for creating a training session within a program.
 */
export const CreateTrainingSessionSchema = Type.Object({
  programId: Type.String({ pattern: UUID_PATTERN, description: 'Training program UUID' }),
  title: Type.String({ minLength: 1, maxLength: 200, description: 'Session title' }),
  date: Type.String({ pattern: DATE_PATTERN, description: 'Session date' }),
  startTime: Type.Optional(Type.String({ description: 'Session start time (HH:MM)' })),
  endTime: Type.Optional(Type.String({ description: 'Session end time (HH:MM)' })),
  location: Type.Optional(Type.String({ maxLength: 200, description: 'Session location' })),
  instructorName: Type.Optional(Type.String({ maxLength: 200, description: 'Instructor name' })),
});

export type CreateTrainingSessionInput = Static<typeof CreateTrainingSessionSchema>;

/**
 * Schema for recording attendance at a training session.
 */
export const RecordTrainingAttendanceSchema = Type.Object({
  sessionId: Type.String({ pattern: UUID_PATTERN, description: 'Training session UUID' }),
  staffId: Type.String({ pattern: UUID_PATTERN, description: 'Staff member UUID' }),
  status: Type.String({
    enum: ['PRESENT', 'ABSENT', 'EXCUSED'],
    description: 'Attendance status',
  }),
  comment: Type.Optional(Type.String({ maxLength: 500, description: 'Attendance comment' })),
});

export type RecordTrainingAttendanceInput = Static<typeof RecordTrainingAttendanceSchema>;

/**
 * Schema for issuing a certification to a staff member.
 */
export const IssueCertificationSchema = Type.Object({
  staffId: Type.String({ pattern: UUID_PATTERN, description: 'Staff member UUID' }),
  programId: Type.String({ pattern: UUID_PATTERN, description: 'Training program UUID' }),
  certificationName: Type.String({ minLength: 1, maxLength: 200, description: 'Certification name' }),
  issuedDate: Type.String({ pattern: DATE_PATTERN, description: 'Date certification was issued' }),
  expiryDate: Type.Optional(Type.String({ pattern: DATE_PATTERN, description: 'Certification expiry date' })),
});

export type IssueCertificationInput = Static<typeof IssueCertificationSchema>;

/**
 * Schema for training program ID path parameter.
 */
export const TrainingProgramParamsSchema = Type.Object({
  programId: Type.String({ pattern: UUID_PATTERN, description: 'Training program UUID' }),
});

export type TrainingProgramParams = Static<typeof TrainingProgramParamsSchema>;

/**
 * Schema for training session ID path parameter.
 */
export const TrainingSessionParamsSchema = Type.Object({
  sessionId: Type.String({ pattern: UUID_PATTERN, description: 'Training session UUID' }),
});

export type TrainingSessionParams = Static<typeof TrainingSessionParamsSchema>;

/**
 * Schema for certification ID path parameter.
 */
export const CertificationParamsSchema = Type.Object({
  certificationId: Type.String({ pattern: UUID_PATTERN, description: 'Certification UUID' }),
});

export type CertificationParams = Static<typeof CertificationParamsSchema>;

/**
 * Schema for training program list query parameters.
 */
export const TrainingProgramListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String({ description: 'Search by program name' })),
});

export type TrainingProgramListQuery = Static<typeof TrainingProgramListQuerySchema>;

/**
 * Schema for certification list query parameters.
 */
export const CertificationListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  staffId: Type.Optional(Type.String({ pattern: UUID_PATTERN, description: 'Filter by staff member' })),
  status: Type.Optional(Type.String({
    enum: ['ACTIVE', 'EXPIRED', 'REVOKED'],
    description: 'Filter by certification status',
  })),
  programId: Type.Optional(Type.String({ pattern: UUID_PATTERN, description: 'Filter by program' })),
});

export type CertificationListQuery = Static<typeof CertificationListQuerySchema>;

/**
 * Schema for training program response.
 */
export const TrainingProgramResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  startDate: Type.String(),
  endDate: Type.String(),
  provider: Type.Union([Type.String(), Type.Null()]),
  certificationName: Type.Union([Type.String(), Type.Null()]),
  certificationValidityDays: Type.Union([Type.Number(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type TrainingProgramResponse = Static<typeof TrainingProgramResponseSchema>;

/**
 * Schema for training session response.
 */
export const TrainingSessionResponseSchema = Type.Object({
  id: Type.String(),
  programId: Type.String(),
  title: Type.String(),
  date: Type.String(),
  startTime: Type.Union([Type.String(), Type.Null()]),
  endTime: Type.Union([Type.String(), Type.Null()]),
  location: Type.Union([Type.String(), Type.Null()]),
  instructorName: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type TrainingSessionResponse = Static<typeof TrainingSessionResponseSchema>;

/**
 * Schema for training attendance response.
 */
export const TrainingAttendanceResponseSchema = Type.Object({
  id: Type.String(),
  sessionId: Type.String(),
  staffId: Type.String(),
  status: Type.String(),
  comment: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export type TrainingAttendanceResponse = Static<typeof TrainingAttendanceResponseSchema>;

/**
 * Schema for certification response.
 */
export const CertificationResponseSchema = Type.Object({
  id: Type.String(),
  staffId: Type.String(),
  programId: Type.String(),
  certificationName: Type.String(),
  issuedDate: Type.String(),
  expiryDate: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type CertificationResponse = Static<typeof CertificationResponseSchema>;
