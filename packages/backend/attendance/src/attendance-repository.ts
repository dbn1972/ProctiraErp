/**
 * Attendance Repository Interface
 *
 * Defines the data access contract for attendance operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 */
import type { AttendanceStatus } from '@proctira/common';

/**
 * Recording mode for student attendance at an institution.
 */
export type RecordingMode = 'class' | 'subject' | 'period';

/**
 * Student attendance record entity.
 */
export interface StudentAttendanceEntity {
  id: string;
  tenantId: string;
  studentId: string;
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  date: string; // ISO date (YYYY-MM-DD)
  subjectId: string | null;
  periodId: string | null;
  status: AttendanceStatus;
  comment: string | null;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Staff attendance record entity.
 */
export interface StaffAttendanceEntity {
  id: string;
  tenantId: string;
  staffId: string;
  institutionId: string;
  date: string; // ISO date (YYYY-MM-DD)
  status: 'PRESENT' | 'ABSENT' | 'ON_LEAVE';
  leaveTypeId: string | null;
  comment: string | null;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Student roster entry for attendance pre-population.
 */
export interface StudentRosterEntry {
  studentId: string;
  studentName: string;
  enrollmentId: string;
  classId: string;
  gradeId: string;
}

/**
 * Academic period entity (minimal, for date validation).
 */
export interface AcademicPeriodInfo {
  id: string;
  tenantId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: string;
}

/**
 * Institution attendance configuration.
 */
export interface InstitutionAttendanceConfig {
  institutionId: string;
  tenantId: string;
  recordingMode: RecordingMode;
  leaveTypes: LeaveTypeConfig[];
}

/**
 * Leave type configuration for staff attendance.
 */
export interface LeaveTypeConfig {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

/**
 * Audit trail entry for attendance modifications.
 */
export interface AttendanceAuditEntry {
  id: string;
  /** Tenant of the parent attendance row — binds RLS for the audit write (G-732). */
  tenantId?: string;
  attendanceId: string;
  previousStatus: AttendanceStatus | null;
  newStatus: AttendanceStatus;
  changedBy: string;
  changedAt: Date;
}

/** Audit payload attached to an atomic attendance write (attendanceId is filled by the repo). */
export type AttendanceWriteAudit = Omit<AttendanceAuditEntry, 'attendanceId' | 'tenantId'>;

/**
 * One step of an all-or-nothing attendance write (PRC-M168). Every op in a
 * batch — attendance row change plus its audit row — commits in a single
 * tenant transaction; any failure rolls the whole batch back.
 *
 * `expectedStatus` (update only) fails the batch with a ConflictError when the
 * row's current status differs (stale regularisation, PRC-M170). The audit
 * `previousStatus` for updates is always taken from the locked DB row, never
 * from the caller.
 */
export type AttendanceWriteOp =
  | {
      kind: 'update';
      id: string;
      data: Partial<StudentAttendanceEntity>;
      expectedStatus?: AttendanceStatus;
      audit?: AttendanceWriteAudit | null;
      /** Only write the audit row when the status actually changes. */
      auditOnlyOnStatusChange?: boolean;
    }
  | {
      kind: 'create';
      data: Omit<StudentAttendanceEntity, 'createdAt' | 'updatedAt'>;
      audit?: AttendanceWriteAudit | null;
    };

/**
 * Query parameters for attendance percentage calculation.
 */
export interface AttendancePercentageQuery {
  /** Scope: 'student', 'class', or 'institution' */
  scope: 'student' | 'class' | 'institution';
  /** Student ID (required when scope is 'student') */
  studentId?: string;
  /** Class ID (required when scope is 'student' or 'class') */
  classId?: string;
  /** Institution ID (required when scope is 'institution') */
  institutionId?: string;
  /** Start date of the range (inclusive, YYYY-MM-DD) */
  startDate: string;
  /** End date of the range (inclusive, YYYY-MM-DD) */
  endDate: string;
}

/** One GROUP BY (student, status) bucket (PRC-M174). */
export interface AttendanceStatusCount {
  studentId: string;
  status: AttendanceStatus;
  count: number;
}

/** Max inclusive span (days) for range reports (PRC-M174). */
export const MAX_ATTENDANCE_RANGE_DAYS = 366;

/**
 * Result of attendance percentage calculation.
 */
export interface AttendancePercentageResult {
  /** Scope of the calculation */
  scope: 'student' | 'class' | 'institution';
  /** Total attendance records in the date range */
  totalRecords: number;
  /** Number of records with PRESENT or LATE status */
  presentCount: number;
  /** Number of records with ABSENT status */
  absentCount: number;
  /** Number of records with EXCUSED status */
  excusedCount: number;
  /** Number of records with LATE status */
  lateCount: number;
  /** Number of EARLY_DEPARTURE records (present-partial, weight 0.5) */
  earlyDepartureCount: number;
  /** Attendance percentage (present + late + 0.5*earlyDeparture) / total */
  attendancePercentage: number;
  /** Absence percentage (absent) / total, rounded to 2 decimal places */
  absencePercentage: number;
  /** Per-student breakdown when scope is class or institution (G-919 CSV). */
  studentRows?: Array<{
    studentId: string;
    totalRecords: number;
    presentCount: number;
    absentCount: number;
    lateCount: number;
    excusedCount: number;
    earlyDepartureCount: number;
    attendancePercentage: number;
  }>;
}

/**
 * Configuration for absence threshold alerting.
 */
export interface AbsenceThresholdConfig {
  /** Institution ID this config applies to */
  institutionId: string;
  /** Tenant ID */
  tenantId: string;
  /** Number of absences that triggers an alert */
  threshold: number;
  /** Evaluation period in days (e.g., 30 means check last 30 days) */
  evaluationPeriodDays: number;
  /** Role IDs of recipients who should receive the alert */
  recipientRoleIds: string[];
}

/**
 * Result of absence threshold check.
 */
export interface ThresholdCheckResult {
  /** Whether the threshold was exceeded */
  exceeded: boolean;
  /** Current absence count in the evaluation period */
  absenceCount: number;
  /** Configured threshold */
  threshold: number;
  /** Evaluation period in days */
  evaluationPeriodDays: number;
  /** Student ID checked */
  studentId: string;
  /** Institution ID */
  institutionId: string;
}

/**
 * Repository interface for attendance data access.
 */
export interface AttendanceRepository {
  // Student attendance
  createStudentAttendance(
    data: Omit<StudentAttendanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StudentAttendanceEntity>;
  updateStudentAttendance(
    id: string,
    tenantId: string,
    data: Partial<StudentAttendanceEntity>,
  ): Promise<StudentAttendanceEntity | null>;
  findStudentAttendance(
    tenantId: string,
    studentId: string,
    classId: string,
    date: string,
    subjectId?: string | null,
    periodId?: string | null,
  ): Promise<StudentAttendanceEntity | null>;
  listStudentAttendance(
    tenantId: string,
    classId: string,
    date: string,
  ): Promise<StudentAttendanceEntity[]>;

  /** Tenant-scoped lookup by id (null when absent or in another tenant). */
  findStudentAttendanceById(tenantId: string, id: string): Promise<StudentAttendanceEntity | null>;

  /**
   * Apply attendance writes and their audit rows in ONE tenant transaction
   * (PRC-M168). Returns the resulting rows in op order. Throws NotFoundError
   * when an update target is missing and ConflictError on expectedStatus
   * mismatch; nothing is persisted on any failure.
   */
  applyStudentAttendanceWrites(
    tenantId: string,
    ops: AttendanceWriteOp[],
  ): Promise<StudentAttendanceEntity[]>;

  // Attendance records by date range (for percentage calculation)
  listStudentAttendanceByDateRange(
    tenantId: string,
    query: AttendancePercentageQuery,
  ): Promise<StudentAttendanceEntity[]>;

  /**
   * PRC-M174: per-student, per-status counts aggregated in the database
   * (GROUP BY student_id, status) so percentage reports never load raw rows.
   */
  countStudentAttendanceByStatus(
    tenantId: string,
    query: AttendancePercentageQuery,
  ): Promise<AttendanceStatusCount[]>;

  /** All of a student's attendance rows in a date range (heatmap; no class filter). */
  listStudentAttendanceByStudentDateRange(
    tenantId: string,
    studentId: string,
    startDate: string,
    endDate: string,
  ): Promise<StudentAttendanceEntity[]>;

  // Count absences for a student within a date range (for threshold checking)
  countStudentAbsences(
    tenantId: string,
    studentId: string,
    institutionId: string,
    startDate: string,
    endDate: string,
  ): Promise<number>;

  // Staff attendance
  createStaffAttendance(
    data: Omit<StaffAttendanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StaffAttendanceEntity>;
  updateStaffAttendance(
    id: string,
    tenantId: string,
    data: Partial<StaffAttendanceEntity>,
  ): Promise<StaffAttendanceEntity | null>;
  findStaffAttendance(
    tenantId: string,
    staffId: string,
    date: string,
  ): Promise<StaffAttendanceEntity | null>;

  // Roster
  getClassRoster(
    tenantId: string,
    classId: string,
    academicPeriodId: string,
    date: string,
  ): Promise<StudentRosterEntry[]>;

  // Academic period
  getActivePeriodForInstitution(
    tenantId: string,
    institutionId: string,
  ): Promise<AcademicPeriodInfo | null>;
  getAcademicPeriodById(tenantId: string, periodId: string): Promise<AcademicPeriodInfo | null>;

  // Institution config
  getInstitutionAttendanceConfig(
    tenantId: string,
    institutionId: string,
  ): Promise<InstitutionAttendanceConfig | null>;

  // Absence threshold config
  getAbsenceThresholdConfig(
    tenantId: string,
    institutionId: string,
  ): Promise<AbsenceThresholdConfig | null>;

  // Audit (tenantId binds the RLS context — attendance_audit derives tenancy from its parent row)
  createAuditEntry(entry: AttendanceAuditEntry): Promise<void>;
  getAuditEntriesForAttendance(
    attendanceId: string,
    tenantId?: string,
  ): Promise<AttendanceAuditEntry[]>;
}
