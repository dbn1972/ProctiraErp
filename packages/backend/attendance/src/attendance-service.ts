/**
 * Attendance Service
 *
 * Business logic for student and staff attendance recording.
 *
 * Requirements:
 * - 9.1: Record student attendance per date by class, subject, or period
 *         with statuses (present, absent, late, excused). Recording mode
 *         (class-level, subject-level, period-level) is configurable per institution.
 * - 9.2: Record staff attendance per date with configurable leave type categories.
 * - 9.3: Pre-populate student list from current enrollment for the active
 *         academic period, excluding students whose enrollment ended before
 *         the attendance date.
 * - 9.7: Accept only current date or past dates within the active academic period.
 *         Reject future dates with an error message.
 */
import {
  BusinessRuleError,
  NotFoundError,
  ValidationError,
  AttendanceStatus,
} from '@proctira/common';
import type { FieldError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  AttendanceRepository,
  StudentAttendanceEntity,
  StaffAttendanceEntity,
  InstitutionAttendanceConfig,
  RecordingMode,
  AttendancePercentageQuery,
  AttendancePercentageResult,
  ThresholdCheckResult,
} from './attendance-repository.js';
import type {
  RecordStudentAttendanceInput,
  RecordBulkStudentAttendanceInput,
  RecordStaffAttendanceInput,
} from './schemas.js';

/**
 * Result of recording bulk attendance.
 */
export interface BulkAttendanceResult {
  recorded: StudentAttendanceEntity[];
  updated: StudentAttendanceEntity[];
  errors: Array<{ studentId: string; message: string }>;
}

/**
 * Roster entry with optional existing attendance data.
 */
export interface RosterWithAttendance {
  studentId: string;
  studentName: string;
  enrollmentId: string;
  classId: string;
  gradeId: string;
  attendance?: {
    id: string;
    status: AttendanceStatus;
    comment: string | null;
  };
}

/**
 * Interface for publishing domain events (e.g., to Kafka).
 * Allows the service to be decoupled from the event infrastructure.
 */
export interface AttendanceEventPublisher {
  /**
   * Publish an absence threshold exceeded event.
   */
  publishAbsenceThresholdExceeded(event: AbsenceThresholdExceededEvent): Promise<void>;
}

/**
 * Payload for the absence threshold exceeded event.
 */
export interface AbsenceThresholdExceededEvent {
  tenantId: string;
  studentId: string;
  institutionId: string;
  absenceCount: number;
  threshold: number;
  evaluationPeriodDays: number;
  evaluationStartDate: string;
  evaluationEndDate: string;
  recipientRoleIds: string[];
}

/**
 * Service handling attendance business logic.
 */
export class AttendanceService {
  constructor(
    private readonly repository: AttendanceRepository,
    private readonly eventPublisher?: AttendanceEventPublisher,
  ) {}

  /**
   * Record attendance for a single student.
   *
   * Validates:
   * - Date is current or past within active academic period (Req 9.7)
   * - Recording mode matches institution configuration (Req 9.1)
   * - If a record already exists for the same student/date/period/subject,
   *   updates it and creates an audit trail (Req 9.6)
   */
  async recordStudentAttendance(
    tenantId: string,
    input: RecordStudentAttendanceInput,
    recordedBy: string,
  ): Promise<StudentAttendanceEntity> {
    // Validate academic period is active
    const period = await this.repository.getAcademicPeriodById(tenantId, input.academicPeriodId);
    if (!period) {
      throw new NotFoundError(`Academic period '${input.academicPeriodId}' not found`);
    }
    if (period.status !== 'active') {
      throw new BusinessRuleError(
        `The referenced academic period is not currently active. ` +
        `Only active periods allow attendance operations.`,
      );
    }

    // Validate attendance date (Req 9.7)
    this.validateAttendanceDate(input.date, period.startDate, period.endDate);

    // Validate recording mode
    const config = await this.repository.getInstitutionAttendanceConfig(tenantId, input.institutionId);
    if (config) {
      this.validateRecordingMode(config.recordingMode, input.subjectId, input.periodId);
    }

    // Check for existing record (Req 9.6 - update existing, maintain audit trail)
    const existing = await this.repository.findStudentAttendance(
      tenantId,
      input.studentId,
      input.classId,
      input.date,
      input.subjectId ?? null,
      input.periodId ?? null,
    );

    if (existing) {
      // Update existing record and create audit entry
      const previousStatus = existing.status;
      const updated = await this.repository.updateStudentAttendance(existing.id, tenantId, {
        status: input.status as AttendanceStatus,
        comment: input.comment ?? null,
        recordedBy,
      });

      if (updated && previousStatus !== input.status) {
        await this.repository.createAuditEntry({
          id: uuidv4(),
          tenantId,
          attendanceId: existing.id,
          previousStatus,
          newStatus: input.status as AttendanceStatus,
          changedBy: recordedBy,
          changedAt: new Date(),
        });
      }

      return updated!;
    }

    // Create new record
    const record = await this.repository.createStudentAttendance({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      institutionId: input.institutionId,
      classId: input.classId,
      academicPeriodId: input.academicPeriodId,
      date: input.date,
      subjectId: input.subjectId ?? null,
      periodId: input.periodId ?? null,
      status: input.status as AttendanceStatus,
      comment: input.comment ?? null,
      recordedBy,
    });

    return record;
  }

  /**
   * Record attendance for an entire class (bulk operation).
   *
   * Validates date and recording mode once, then processes all records.
   */
  async recordBulkStudentAttendance(
    tenantId: string,
    input: RecordBulkStudentAttendanceInput,
    recordedBy: string,
  ): Promise<BulkAttendanceResult> {
    // Validate academic period is active
    const period = await this.repository.getAcademicPeriodById(tenantId, input.academicPeriodId);
    if (!period) {
      throw new NotFoundError(`Academic period '${input.academicPeriodId}' not found`);
    }
    if (period.status !== 'active') {
      throw new BusinessRuleError(
        `The referenced academic period is not currently active. ` +
        `Only active periods allow attendance operations.`,
      );
    }

    // Validate attendance date (Req 9.7)
    this.validateAttendanceDate(input.date, period.startDate, period.endDate);

    // Validate recording mode
    const config = await this.repository.getInstitutionAttendanceConfig(tenantId, input.institutionId);
    if (config) {
      this.validateRecordingMode(config.recordingMode, input.subjectId, input.periodId);
    }

    const result: BulkAttendanceResult = {
      recorded: [],
      updated: [],
      errors: [],
    };

    for (const record of input.records) {
      try {
        const existing = await this.repository.findStudentAttendance(
          tenantId,
          record.studentId,
          input.classId,
          input.date,
          input.subjectId ?? null,
          input.periodId ?? null,
        );

        if (existing) {
          const previousStatus = existing.status;
          const updated = await this.repository.updateStudentAttendance(existing.id, tenantId, {
            status: record.status as AttendanceStatus,
            comment: record.comment ?? null,
            recordedBy,
          });

          if (updated && previousStatus !== record.status) {
            await this.repository.createAuditEntry({
              id: uuidv4(),
              tenantId,
              attendanceId: existing.id,
              previousStatus,
              newStatus: record.status as AttendanceStatus,
              changedBy: recordedBy,
              changedAt: new Date(),
            });
          }

          if (updated) {
            result.updated.push(updated);
          }
        } else {
          const created = await this.repository.createStudentAttendance({
            id: uuidv4(),
            tenantId,
            studentId: record.studentId,
            institutionId: input.institutionId,
            classId: input.classId,
            academicPeriodId: input.academicPeriodId,
            date: input.date,
            subjectId: input.subjectId ?? null,
            periodId: input.periodId ?? null,
            status: record.status as AttendanceStatus,
            comment: record.comment ?? null,
            recordedBy,
          });
          result.recorded.push(created);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({ studentId: record.studentId, message });
      }
    }

    return result;
  }

  /**
   * Record staff attendance.
   *
   * Validates:
   * - Date is valid (not future)
   * - If status is ON_LEAVE, leaveTypeId must be provided and valid
   * - If a record already exists for the same staff/date, updates it
   *
   * Requirement 9.2: Record staff attendance per date with configurable leave type categories.
   */
  async recordStaffAttendance(
    tenantId: string,
    input: RecordStaffAttendanceInput,
    recordedBy: string,
  ): Promise<StaffAttendanceEntity> {
    // Validate leave type if status is ON_LEAVE
    if (input.status === 'ON_LEAVE') {
      if (!input.leaveTypeId) {
        throw new ValidationError('Leave type is required when status is ON_LEAVE', [
          { field: 'leaveTypeId', rule: 'required', message: 'Leave type is required when status is ON_LEAVE' },
        ]);
      }

      // Validate leave type exists and is active
      const config = await this.repository.getInstitutionAttendanceConfig(tenantId, input.institutionId);
      if (config) {
        const leaveType = config.leaveTypes.find(lt => lt.id === input.leaveTypeId && lt.isActive);
        if (!leaveType) {
          throw new ValidationError('Invalid or inactive leave type', [
            { field: 'leaveTypeId', rule: 'invalid', message: 'The specified leave type does not exist or is inactive' },
          ]);
        }
      }
    }

    // Validate date is not in the future
    const attendanceDate = new Date(input.date + 'T00:00:00Z');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    if (attendanceDate > today) {
      throw new BusinessRuleError(
        'Future attendance cannot be recorded. Please select the current date or a past date.',
      );
    }

    // Check for existing record
    const existing = await this.repository.findStaffAttendance(tenantId, input.staffId, input.date);

    if (existing) {
      const updated = await this.repository.updateStaffAttendance(existing.id, tenantId, {
        status: input.status,
        leaveTypeId: input.leaveTypeId ?? null,
        comment: input.comment ?? null,
        recordedBy,
      });
      return updated!;
    }

    // Create new record
    const record = await this.repository.createStaffAttendance({
      id: uuidv4(),
      tenantId,
      staffId: input.staffId,
      institutionId: input.institutionId,
      date: input.date,
      status: input.status,
      leaveTypeId: input.leaveTypeId ?? null,
      comment: input.comment ?? null,
      recordedBy,
    });

    return record;
  }

  /**
   * Get class roster with existing attendance data for a given date.
   *
   * Requirement 9.3: Pre-populate student list from current enrollment for
   * the active academic period, excluding students whose enrollment ended
   * before the attendance date.
   */
  async getClassRoster(
    tenantId: string,
    classId: string,
    academicPeriodId: string,
    date: string,
  ): Promise<RosterWithAttendance[]> {
    // Get enrolled students for the class
    const roster = await this.repository.getClassRoster(tenantId, classId, academicPeriodId, date);

    // Get existing attendance records for the date
    const existingRecords = await this.repository.listStudentAttendance(tenantId, classId, date);

    // Merge roster with existing attendance
    return roster.map(entry => {
      const attendanceRecord = existingRecords.find(r => r.studentId === entry.studentId);
      return {
        ...entry,
        attendance: attendanceRecord
          ? {
              id: attendanceRecord.id,
              status: attendanceRecord.status,
              comment: attendanceRecord.comment,
            }
          : undefined,
      };
    });
  }

  /**
   * Get institution attendance configuration.
   */
  async getAttendanceConfig(
    tenantId: string,
    institutionId: string,
  ): Promise<InstitutionAttendanceConfig> {
    const config = await this.repository.getInstitutionAttendanceConfig(tenantId, institutionId);
    if (!config) {
      // Return default configuration if none exists
      return {
        institutionId,
        tenantId,
        recordingMode: 'class',
        leaveTypes: [],
      };
    }
    return config;
  }

  /**
   * Validate that the attendance date is current or past within the active academic period.
   *
   * Requirement 9.7: Accept only the current date or past dates within the active
   * academic period. Reject future dates with an error message.
   *
   * @throws BusinessRuleError if date is in the future or outside the academic period
   */
  validateAttendanceDate(date: string, periodStart: Date, periodEnd: Date): void {
    const attendanceDate = new Date(date + 'T00:00:00Z');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Reject future dates
    if (attendanceDate > today) {
      throw new BusinessRuleError(
        'Future attendance cannot be recorded. Please select the current date or a past date.',
      );
    }

    // Validate date is within academic period bounds
    const periodStartDate = new Date(periodStart);
    periodStartDate.setUTCHours(0, 0, 0, 0);
    const periodEndDate = new Date(periodEnd);
    periodEndDate.setUTCHours(0, 0, 0, 0);

    if (attendanceDate < periodStartDate) {
      throw new BusinessRuleError(
        `Attendance date ${date} is before the academic period start date. ` +
        `The active period starts on ${periodStartDate.toISOString().slice(0, 10)}.`,
      );
    }

    if (attendanceDate > periodEndDate) {
      throw new BusinessRuleError(
        `Attendance date ${date} is after the academic period end date. ` +
        `The active period ends on ${periodEndDate.toISOString().slice(0, 10)}.`,
      );
    }
  }

  /**
   * Validate that the recording mode matches the institution configuration.
   *
   * - class-level: no subjectId or periodId required
   * - subject-level: subjectId required
   * - period-level: periodId required
   */
  validateRecordingMode(
    mode: RecordingMode,
    subjectId?: string,
    periodId?: string,
  ): void {
    const errors: FieldError[] = [];

    switch (mode) {
      case 'subject':
        if (!subjectId) {
          errors.push({
            field: 'subjectId',
            rule: 'required',
            message: 'Subject is required for subject-level attendance recording',
          });
        }
        break;
      case 'period':
        if (!periodId) {
          errors.push({
            field: 'periodId',
            rule: 'required',
            message: 'Period is required for period-level attendance recording',
          });
        }
        break;
      case 'class':
        // No additional fields required for class-level recording
        break;
    }

    if (errors.length > 0) {
      throw new ValidationError(
        `Recording mode '${mode}' requires additional fields`,
        errors,
      );
    }
  }

  /**
   * Calculate attendance percentage for a student, class, or institution
   * within a configurable date range.
   *
   * Requirement 9.4: Calculate attendance percentages per student, class, and
   * institution for configurable date ranges, rounded to two decimal places.
   *
   * @param tenantId - Tenant context
   * @param query - Query parameters specifying scope and date range
   * @returns Attendance percentage result rounded to 2 decimal places
   */
  async calculateAttendancePercentage(
    tenantId: string,
    query: AttendancePercentageQuery,
  ): Promise<AttendancePercentageResult> {
    // Validate query parameters
    if (query.scope === 'student' && (!query.studentId || !query.classId)) {
      throw new ValidationError('Student scope requires studentId and classId', [
        ...(!query.studentId ? [{ field: 'studentId', rule: 'required', message: 'studentId is required for student scope' }] : []),
        ...(!query.classId ? [{ field: 'classId', rule: 'required', message: 'classId is required for student scope' }] : []),
      ]);
    }
    if (query.scope === 'class' && !query.classId) {
      throw new ValidationError('Class scope requires classId', [
        { field: 'classId', rule: 'required', message: 'classId is required for class scope' },
      ]);
    }
    if (query.scope === 'institution' && !query.institutionId) {
      throw new ValidationError('Institution scope requires institutionId', [
        { field: 'institutionId', rule: 'required', message: 'institutionId is required for institution scope' },
      ]);
    }

    if (query.startDate > query.endDate) {
      throw new ValidationError('startDate must be before or equal to endDate', [
        { field: 'startDate', rule: 'range', message: 'startDate must be before or equal to endDate' },
      ]);
    }

    const records = await this.repository.listStudentAttendanceByDateRange(tenantId, query);

    const totalRecords = records.length;

    if (totalRecords === 0) {
      return {
        scope: query.scope,
        totalRecords: 0,
        presentCount: 0,
        absentCount: 0,
        excusedCount: 0,
        lateCount: 0,
        attendancePercentage: 0,
        absencePercentage: 0,
      };
    }

    const presentCount = records.filter(r => r.status === AttendanceStatus.PRESENT).length;
    const absentCount = records.filter(r => r.status === AttendanceStatus.ABSENT).length;
    const excusedCount = records.filter(r => r.status === AttendanceStatus.EXCUSED).length;
    const lateCount = records.filter(r => r.status === AttendanceStatus.LATE).length;

    // Attendance percentage: (present + late) / total * 100, rounded to 2 decimal places
    const attendancePercentage = Math.round(((presentCount + lateCount) / totalRecords) * 10000) / 100;
    // Absence percentage: absent / total * 100, rounded to 2 decimal places
    const absencePercentage = Math.round((absentCount / totalRecords) * 10000) / 100;

    return {
      scope: query.scope,
      totalRecords,
      presentCount,
      absentCount,
      excusedCount,
      lateCount,
      attendancePercentage,
      absencePercentage,
    };
  }

  /**
   * Check if a student's absence count exceeds the configured threshold
   * within the evaluation period.
   *
   * Requirement 9.5: IF a student's absence count exceeds a configurable threshold
   * within a configurable evaluation period, THEN trigger an alert notification
   * via the Notification_Service to recipients designated by role assignment.
   *
   * @param tenantId - Tenant context
   * @param studentId - Student to check
   * @param institutionId - Institution context
   * @returns Threshold check result indicating whether threshold was exceeded
   */
  async checkAbsenceThreshold(
    tenantId: string,
    studentId: string,
    institutionId: string,
  ): Promise<ThresholdCheckResult> {
    const config = await this.repository.getAbsenceThresholdConfig(tenantId, institutionId);

    if (!config) {
      // No threshold configured — return not exceeded with defaults
      return {
        exceeded: false,
        absenceCount: 0,
        threshold: 0,
        evaluationPeriodDays: 0,
        studentId,
        institutionId,
      };
    }

    // Calculate the evaluation period date range
    const endDate = new Date();
    endDate.setUTCHours(0, 0, 0, 0);
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - config.evaluationPeriodDays);

    const startDateStr = startDate.toISOString().split('T')[0]!;
    const endDateStr = endDate.toISOString().split('T')[0]!;

    const absenceCount = await this.repository.countStudentAbsences(
      tenantId,
      studentId,
      institutionId,
      startDateStr,
      endDateStr,
    );

    const exceeded = absenceCount > config.threshold;

    // If threshold exceeded, publish Kafka event for notification
    if (exceeded && this.eventPublisher) {
      await this.eventPublisher.publishAbsenceThresholdExceeded({
        tenantId,
        studentId,
        institutionId,
        absenceCount,
        threshold: config.threshold,
        evaluationPeriodDays: config.evaluationPeriodDays,
        evaluationStartDate: startDateStr,
        evaluationEndDate: endDateStr,
        recipientRoleIds: config.recipientRoleIds,
      });
    }

    return {
      exceeded,
      absenceCount,
      threshold: config.threshold,
      evaluationPeriodDays: config.evaluationPeriodDays,
      studentId,
      institutionId,
    };
  }

  /**
   * Get audit trail entries for a specific attendance record.
   *
   * Requirement 9.6: Maintain an audit trail of changes with previous status value.
   */
  async getAttendanceAuditTrail(
    attendanceId: string,
    tenantId?: string,
  ): Promise<Array<{ previousStatus: string | null; newStatus: string; changedBy: string; changedAt: Date }>> {
    const entries = await this.repository.getAuditEntriesForAttendance(attendanceId, tenantId);
    return entries.map(e => ({
      previousStatus: e.previousStatus,
      newStatus: e.newStatus,
      changedBy: e.changedBy,
      changedAt: e.changedAt,
    }));
  }
}
