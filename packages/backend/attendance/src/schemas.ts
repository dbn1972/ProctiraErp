/**
 * Typebox schemas for Attendance Service request/response validation.
 *
 * Defines schemas for:
 * - RecordStudentAttendance (body)
 * - RecordStaffAttendance (body)
 * - GetClassRoster (query)
 * - AttendanceResponse (response)
 *
 * Requirements:
 * - 9.1: Record student attendance per date by class, subject, or period
 * - 9.2: Record staff attendance per date with configurable leave type categories
 * - 9.3: Pre-populate student list from current enrollment
 * - 9.7: Accept only current or past dates within active academic period
 */
import { Type, type Static } from '@sinclair/typebox';

const UuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const DatePattern = '^\\d{4}-\\d{2}-\\d{2}$';

/**
 * Schema for recording a single student's attendance.
 */
export const RecordStudentAttendanceSchema = Type.Object({
  studentId: Type.String({
    pattern: UuidPattern,
    description: 'Student UUID',
  }),
  institutionId: Type.String({
    pattern: UuidPattern,
    description: 'Institution UUID',
  }),
  classId: Type.String({
    pattern: UuidPattern,
    description: 'Class UUID',
  }),
  academicPeriodId: Type.String({
    pattern: UuidPattern,
    description: 'Academic period UUID',
  }),
  date: Type.String({
    pattern: DatePattern,
    description: 'Attendance date (YYYY-MM-DD)',
  }),
  subjectId: Type.Optional(
    Type.String({
      pattern: UuidPattern,
      description: 'Subject UUID (for subject-level recording)',
    }),
  ),
  periodId: Type.Optional(
    Type.String({
      pattern: UuidPattern,
      description: 'Period UUID (for period-level recording)',
    }),
  ),
  status: Type.Union(
    [
      Type.Literal('PRESENT'),
      Type.Literal('ABSENT'),
      Type.Literal('LATE'),
      Type.Literal('EXCUSED'),
      Type.Literal('EARLY_DEPARTURE'),
    ],
    { description: 'Attendance status' },
  ),
  comment: Type.Optional(
    Type.String({
      maxLength: 500,
      description: 'Optional comment',
    }),
  ),
});

export type RecordStudentAttendanceInput = Static<typeof RecordStudentAttendanceSchema>;

/**
 * Schema for recording bulk student attendance (entire class at once).
 */
export const RecordBulkStudentAttendanceSchema = Type.Object({
  institutionId: Type.String({
    pattern: UuidPattern,
    description: 'Institution UUID',
  }),
  classId: Type.String({
    pattern: UuidPattern,
    description: 'Class UUID',
  }),
  academicPeriodId: Type.String({
    pattern: UuidPattern,
    description: 'Academic period UUID',
  }),
  date: Type.String({
    pattern: DatePattern,
    description: 'Attendance date (YYYY-MM-DD)',
  }),
  subjectId: Type.Optional(
    Type.String({
      pattern: UuidPattern,
      description: 'Subject UUID (for subject-level recording)',
    }),
  ),
  periodId: Type.Optional(
    Type.String({
      pattern: UuidPattern,
      description: 'Period UUID (for period-level recording)',
    }),
  ),
  records: Type.Array(
    Type.Object({
      studentId: Type.String({
        pattern: UuidPattern,
        description: 'Student UUID',
      }),
      status: Type.Union(
        [
          Type.Literal('PRESENT'),
          Type.Literal('ABSENT'),
          Type.Literal('LATE'),
          Type.Literal('EXCUSED'),
          Type.Literal('EARLY_DEPARTURE'),
        ],
        { description: 'Attendance status' },
      ),
      comment: Type.Optional(
        Type.String({
          maxLength: 500,
          description: 'Optional comment',
        }),
      ),
    }),
    { minItems: 1, description: 'Array of student attendance records' },
  ),
});

export type RecordBulkStudentAttendanceInput = Static<typeof RecordBulkStudentAttendanceSchema>;

/**
 * Schema for recording staff attendance.
 */
export const RecordStaffAttendanceSchema = Type.Object({
  staffId: Type.String({
    pattern: UuidPattern,
    description: 'Staff UUID',
  }),
  institutionId: Type.String({
    pattern: UuidPattern,
    description: 'Institution UUID',
  }),
  date: Type.String({
    pattern: DatePattern,
    description: 'Attendance date (YYYY-MM-DD)',
  }),
  status: Type.Union([Type.Literal('PRESENT'), Type.Literal('ABSENT'), Type.Literal('ON_LEAVE')], {
    description: 'Staff attendance status',
  }),
  leaveTypeId: Type.Optional(
    Type.String({
      pattern: UuidPattern,
      description: 'Leave type UUID (required when status is ON_LEAVE)',
    }),
  ),
  comment: Type.Optional(
    Type.String({
      maxLength: 500,
      description: 'Optional comment',
    }),
  ),
});

export type RecordStaffAttendanceInput = Static<typeof RecordStaffAttendanceSchema>;

/**
 * Schema for class roster query parameters.
 */
export const ClassRosterQuerySchema = Type.Object({
  classId: Type.String({
    pattern: UuidPattern,
    description: 'Class UUID',
  }),
  academicPeriodId: Type.String({
    pattern: UuidPattern,
    description: 'Academic period UUID',
  }),
  date: Type.String({
    pattern: DatePattern,
    description: 'Date for roster (YYYY-MM-DD)',
  }),
});

export type ClassRosterQuery = Static<typeof ClassRosterQuerySchema>;

/**
 * Schema for attendance ID path parameter.
 */
export const AttendanceParamsSchema = Type.Object({
  id: Type.String({
    pattern: UuidPattern,
    description: 'Attendance record UUID',
  }),
});

export type AttendanceParams = Static<typeof AttendanceParamsSchema>;

/**
 * Schema for student attendance response.
 */
export const StudentAttendanceResponseSchema = Type.Object({
  id: Type.String({ description: 'Attendance record UUID' }),
  studentId: Type.String({ description: 'Student UUID' }),
  institutionId: Type.String({ description: 'Institution UUID' }),
  classId: Type.String({ description: 'Class UUID' }),
  academicPeriodId: Type.String({ description: 'Academic period UUID' }),
  date: Type.String({ description: 'Attendance date (YYYY-MM-DD)' }),
  subjectId: Type.Union([Type.String(), Type.Null()], { description: 'Subject UUID' }),
  periodId: Type.Union([Type.String(), Type.Null()], { description: 'Period UUID' }),
  status: Type.String({ description: 'Attendance status' }),
  comment: Type.Union([Type.String(), Type.Null()], { description: 'Comment' }),
  recordedBy: Type.String({ description: 'User who recorded the attendance' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type StudentAttendanceResponse = Static<typeof StudentAttendanceResponseSchema>;

/**
 * Schema for staff attendance response.
 */
export const StaffAttendanceResponseSchema = Type.Object({
  id: Type.String({ description: 'Attendance record UUID' }),
  staffId: Type.String({ description: 'Staff UUID' }),
  institutionId: Type.String({ description: 'Institution UUID' }),
  date: Type.String({ description: 'Attendance date (YYYY-MM-DD)' }),
  status: Type.String({ description: 'Staff attendance status' }),
  leaveTypeId: Type.Union([Type.String(), Type.Null()], { description: 'Leave type UUID' }),
  comment: Type.Union([Type.String(), Type.Null()], { description: 'Comment' }),
  recordedBy: Type.String({ description: 'User who recorded the attendance' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type StaffAttendanceResponse = Static<typeof StaffAttendanceResponseSchema>;

/**
 * Schema for class roster response entry.
 */
export const RosterEntryResponseSchema = Type.Object({
  studentId: Type.String({ description: 'Student UUID' }),
  studentName: Type.String({ description: 'Student full name' }),
  enrollmentId: Type.String({ description: 'Enrollment UUID' }),
  classId: Type.String({ description: 'Class UUID' }),
  gradeId: Type.String({ description: 'Grade UUID' }),
  attendance: Type.Optional(
    Type.Object({
      id: Type.String({ description: 'Existing attendance record UUID' }),
      status: Type.String({ description: 'Current attendance status' }),
      comment: Type.Union([Type.String(), Type.Null()], { description: 'Comment' }),
    }),
  ),
});

export type RosterEntryResponse = Static<typeof RosterEntryResponseSchema>;

/**
 * Schema for institution attendance configuration response.
 */
export const AttendanceConfigResponseSchema = Type.Object({
  institutionId: Type.String({ description: 'Institution UUID' }),
  recordingMode: Type.Union(
    [Type.Literal('class'), Type.Literal('subject'), Type.Literal('period')],
    { description: 'Attendance recording mode' },
  ),
  leaveTypes: Type.Array(
    Type.Object({
      id: Type.String({ description: 'Leave type UUID' }),
      name: Type.String({ description: 'Leave type name' }),
      code: Type.String({ description: 'Leave type code' }),
      isActive: Type.Boolean({ description: 'Whether the leave type is active' }),
    }),
  ),
});

export type AttendanceConfigResponse = Static<typeof AttendanceConfigResponseSchema>;

/**
 * Schema for attendance percentage query parameters.
 */
export const AttendancePercentageQuerySchema = Type.Object({
  scope: Type.Union([Type.Literal('student'), Type.Literal('class'), Type.Literal('institution')], {
    description: 'Scope of percentage calculation',
  }),
  studentId: Type.Optional(
    Type.String({
      pattern: UuidPattern,
      description: 'Student UUID (required for student scope)',
    }),
  ),
  classId: Type.Optional(
    Type.String({
      pattern: UuidPattern,
      description: 'Class UUID (required for student and class scope)',
    }),
  ),
  institutionId: Type.Optional(
    Type.String({
      pattern: UuidPattern,
      description: 'Institution UUID (required for institution scope)',
    }),
  ),
  startDate: Type.String({
    pattern: DatePattern,
    description: 'Start date of the range (YYYY-MM-DD)',
  }),
  endDate: Type.String({
    pattern: DatePattern,
    description: 'End date of the range (YYYY-MM-DD)',
  }),
});

export type AttendancePercentageQueryInput = Static<typeof AttendancePercentageQuerySchema>;

/**
 * Schema for attendance percentage response.
 */
export const AttendancePercentageResponseSchema = Type.Object({
  scope: Type.String({ description: 'Scope of the calculation' }),
  totalRecords: Type.Number({ description: 'Total attendance records in the date range' }),
  presentCount: Type.Number({ description: 'Number of PRESENT records' }),
  absentCount: Type.Number({ description: 'Number of ABSENT records' }),
  excusedCount: Type.Number({ description: 'Number of EXCUSED records' }),
  lateCount: Type.Number({ description: 'Number of LATE records' }),
  earlyDepartureCount: Type.Number({
    description: 'Number of EARLY_DEPARTURE records (present-partial, weight 0.5)',
  }),
  attendancePercentage: Type.Number({
    description:
      'Attendance percentage (present + late + 0.5*earlyDeparture) / total, rounded to 2 decimal places',
  }),
  studentRows: Type.Optional(
    Type.Array(
      Type.Object({
        studentId: Type.String(),
        totalRecords: Type.Number(),
        presentCount: Type.Number(),
        absentCount: Type.Number(),
        lateCount: Type.Number(),
        excusedCount: Type.Number(),
        earlyDepartureCount: Type.Number(),
        attendancePercentage: Type.Number(),
      }),
    ),
  ),
  absencePercentage: Type.Number({
    description: 'Absence percentage (absent / total), rounded to 2 decimal places',
  }),
});

export type AttendancePercentageResponse = Static<typeof AttendancePercentageResponseSchema>;

/**
 * Schema for absence threshold check query parameters.
 */
export const AbsenceThresholdCheckQuerySchema = Type.Object({
  studentId: Type.String({
    pattern: UuidPattern,
    description: 'Student UUID',
  }),
  institutionId: Type.String({
    pattern: UuidPattern,
    description: 'Institution UUID',
  }),
});

export type AbsenceThresholdCheckQueryInput = Static<typeof AbsenceThresholdCheckQuerySchema>;

/**
 * Schema for absence threshold check response.
 */
export const AbsenceThresholdCheckResponseSchema = Type.Object({
  exceeded: Type.Boolean({ description: 'Whether the threshold was exceeded' }),
  absenceCount: Type.Number({ description: 'Current absence count in the evaluation period' }),
  threshold: Type.Number({ description: 'Configured threshold' }),
  evaluationPeriodDays: Type.Number({ description: 'Evaluation period in days' }),
  studentId: Type.String({ description: 'Student UUID' }),
  institutionId: Type.String({ description: 'Institution UUID' }),
});

export type AbsenceThresholdCheckResponse = Static<typeof AbsenceThresholdCheckResponseSchema>;

/**
 * Schema for attendance audit trail query.
 */
export const AttendanceAuditQuerySchema = Type.Object({
  attendanceId: Type.String({
    pattern: UuidPattern,
    description: 'Attendance record UUID',
  }),
});

export type AttendanceAuditQueryInput = Static<typeof AttendanceAuditQuerySchema>;
