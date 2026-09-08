/**
 * Attendance Service Unit Tests
 *
 * Tests core business logic for student and staff attendance recording.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BusinessRuleError,
  ValidationError,
  NotFoundError,
  AttendanceStatus,
} from '@proctira/common';

import { AttendanceService } from './attendance-service.js';
import type {
  AttendanceEventPublisher,
  AbsenceThresholdExceededEvent,
} from './attendance-service.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import type {
  AcademicPeriodInfo,
  InstitutionAttendanceConfig,
  AbsenceThresholdConfig,
} from './attendance-repository.js';

// Test fixtures
const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const STAFF_ID = '44444444-4444-4444-8444-444444444444';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';
const SUBJECT_ID = '66666666-6666-4666-8666-666666666666';
const RECORDED_BY = 'user-001';

function createActivePeriod(overrides?: Partial<AcademicPeriodInfo>): AcademicPeriodInfo {
  return {
    id: PERIOD_ID,
    tenantId: TENANT_ID,
    name: 'Academic Year 2024',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    status: 'active',
    ...overrides,
  };
}

function createInstitutionConfig(
  mode: 'class' | 'subject' | 'period' = 'class',
): InstitutionAttendanceConfig {
  return {
    institutionId: INSTITUTION_ID,
    tenantId: TENANT_ID,
    recordingMode: mode,
    leaveTypes: [
      { id: 'lt-001', name: 'Sick Leave', code: 'SICK', isActive: true },
      { id: 'lt-002', name: 'Personal Leave', code: 'PERSONAL', isActive: true },
      { id: 'lt-003', name: 'Maternity Leave', code: 'MATERNITY', isActive: false },
    ],
  };
}

describe('AttendanceService', () => {
  let service: AttendanceService;
  let repository: InMemoryAttendanceRepository;

  beforeEach(() => {
    repository = new InMemoryAttendanceRepository();
    service = new AttendanceService(repository);

    // Set up default active period
    repository.addAcademicPeriod(createActivePeriod());
  });

  describe('recordStudentAttendance', () => {
    it('should record attendance for a student on a valid date', async () => {
      const result = await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      expect(result.studentId).toBe(STUDENT_ID);
      expect(result.status).toBe(AttendanceStatus.PRESENT);
      expect(result.date).toBe('2024-06-15');
      expect(result.recordedBy).toBe(RECORDED_BY);
    });

    it('should reject future dates', async () => {
      // Use a date far in the future
      await expect(
        service.recordStudentAttendance(
          TENANT_ID,
          {
            studentId: STUDENT_ID,
            institutionId: INSTITUTION_ID,
            classId: CLASS_ID,
            academicPeriodId: PERIOD_ID,
            date: '2099-12-31',
            status: 'PRESENT',
          },
          RECORDED_BY,
        ),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should reject dates before academic period start', async () => {
      await expect(
        service.recordStudentAttendance(
          TENANT_ID,
          {
            studentId: STUDENT_ID,
            institutionId: INSTITUTION_ID,
            classId: CLASS_ID,
            academicPeriodId: PERIOD_ID,
            date: '2023-12-31',
            status: 'PRESENT',
          },
          RECORDED_BY,
        ),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should reject dates after academic period end', async () => {
      // Set up a period that ended in the past
      repository.clear();
      repository.addAcademicPeriod(
        createActivePeriod({
          startDate: new Date('2023-01-01'),
          endDate: new Date('2023-06-30'),
        }),
      );

      await expect(
        service.recordStudentAttendance(
          TENANT_ID,
          {
            studentId: STUDENT_ID,
            institutionId: INSTITUTION_ID,
            classId: CLASS_ID,
            academicPeriodId: PERIOD_ID,
            date: '2023-07-01',
            status: 'PRESENT',
          },
          RECORDED_BY,
        ),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw NotFoundError for non-existent academic period', async () => {
      await expect(
        service.recordStudentAttendance(
          TENANT_ID,
          {
            studentId: STUDENT_ID,
            institutionId: INSTITUTION_ID,
            classId: CLASS_ID,
            academicPeriodId: '99999999-9999-4999-8999-999999999999',
            date: '2024-06-15',
            status: 'PRESENT',
          },
          RECORDED_BY,
        ),
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject attendance for inactive academic period', async () => {
      repository.clear();
      repository.addAcademicPeriod(createActivePeriod({ status: 'inactive' }));

      await expect(
        service.recordStudentAttendance(
          TENANT_ID,
          {
            studentId: STUDENT_ID,
            institutionId: INSTITUTION_ID,
            classId: CLASS_ID,
            academicPeriodId: PERIOD_ID,
            date: '2024-06-15',
            status: 'PRESENT',
          },
          RECORDED_BY,
        ),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should update existing record and create audit trail', async () => {
      // First record
      await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      // Update same record
      const updated = await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'ABSENT',
        },
        RECORDED_BY,
      );

      expect(updated.status).toBe(AttendanceStatus.ABSENT);

      // Verify audit trail
      const auditEntries = repository.getAuditEntries();
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]!.previousStatus).toBe(AttendanceStatus.PRESENT);
      expect(auditEntries[0]!.newStatus).toBe(AttendanceStatus.ABSENT);
    });

    it('should not create audit entry when status does not change', async () => {
      await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      // Record same status again
      await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'PRESENT',
          comment: 'Updated comment',
        },
        RECORDED_BY,
      );

      const auditEntries = repository.getAuditEntries();
      expect(auditEntries).toHaveLength(0);
    });

    it('should require subjectId for subject-level recording mode', async () => {
      repository.addInstitutionConfig(createInstitutionConfig('subject'));

      await expect(
        service.recordStudentAttendance(
          TENANT_ID,
          {
            studentId: STUDENT_ID,
            institutionId: INSTITUTION_ID,
            classId: CLASS_ID,
            academicPeriodId: PERIOD_ID,
            date: '2024-06-15',
            status: 'PRESENT',
          },
          RECORDED_BY,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('should require periodId for period-level recording mode', async () => {
      repository.addInstitutionConfig(createInstitutionConfig('period'));

      await expect(
        service.recordStudentAttendance(
          TENANT_ID,
          {
            studentId: STUDENT_ID,
            institutionId: INSTITUTION_ID,
            classId: CLASS_ID,
            academicPeriodId: PERIOD_ID,
            date: '2024-06-15',
            status: 'PRESENT',
          },
          RECORDED_BY,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('should accept subject-level recording with subjectId', async () => {
      repository.addInstitutionConfig(createInstitutionConfig('subject'));

      const result = await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          subjectId: SUBJECT_ID,
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      expect(result.subjectId).toBe(SUBJECT_ID);
    });

    it('should accept period-level recording with periodId', async () => {
      repository.addInstitutionConfig(createInstitutionConfig('period'));
      const periodSlotId = '77777777-7777-4777-8777-777777777777';

      const result = await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          periodId: periodSlotId,
          status: 'LATE',
        },
        RECORDED_BY,
      );

      expect(result.periodId).toBe(periodSlotId);
      expect(result.status).toBe(AttendanceStatus.LATE);
    });
  });

  describe('recordStaffAttendance', () => {
    it('should record staff attendance for a valid date', async () => {
      const result = await service.recordStaffAttendance(
        TENANT_ID,
        {
          staffId: STAFF_ID,
          institutionId: INSTITUTION_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      expect(result.staffId).toBe(STAFF_ID);
      expect(result.status).toBe('PRESENT');
      expect(result.date).toBe('2024-06-15');
    });

    it('should reject future dates for staff attendance', async () => {
      await expect(
        service.recordStaffAttendance(
          TENANT_ID,
          {
            staffId: STAFF_ID,
            institutionId: INSTITUTION_ID,
            date: '2099-12-31',
            status: 'PRESENT',
          },
          RECORDED_BY,
        ),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should require leaveTypeId when status is ON_LEAVE', async () => {
      repository.addInstitutionConfig(createInstitutionConfig());

      await expect(
        service.recordStaffAttendance(
          TENANT_ID,
          {
            staffId: STAFF_ID,
            institutionId: INSTITUTION_ID,
            date: '2024-06-15',
            status: 'ON_LEAVE',
          },
          RECORDED_BY,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject inactive leave types', async () => {
      repository.addInstitutionConfig(createInstitutionConfig());

      await expect(
        service.recordStaffAttendance(
          TENANT_ID,
          {
            staffId: STAFF_ID,
            institutionId: INSTITUTION_ID,
            date: '2024-06-15',
            status: 'ON_LEAVE',
            leaveTypeId: 'lt-003', // Maternity Leave is inactive
          },
          RECORDED_BY,
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('should accept valid leave type for ON_LEAVE status', async () => {
      repository.addInstitutionConfig(createInstitutionConfig());

      const result = await service.recordStaffAttendance(
        TENANT_ID,
        {
          staffId: STAFF_ID,
          institutionId: INSTITUTION_ID,
          date: '2024-06-15',
          status: 'ON_LEAVE',
          leaveTypeId: 'lt-001', // Sick Leave is active
        },
        RECORDED_BY,
      );

      expect(result.status).toBe('ON_LEAVE');
      expect(result.leaveTypeId).toBe('lt-001');
    });

    it('should update existing staff attendance record', async () => {
      await service.recordStaffAttendance(
        TENANT_ID,
        {
          staffId: STAFF_ID,
          institutionId: INSTITUTION_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      const updated = await service.recordStaffAttendance(
        TENANT_ID,
        {
          staffId: STAFF_ID,
          institutionId: INSTITUTION_ID,
          date: '2024-06-15',
          status: 'ABSENT',
        },
        RECORDED_BY,
      );

      expect(updated.status).toBe('ABSENT');

      // Should only have one record
      const records = repository.getStaffAttendanceRecords();
      expect(records).toHaveLength(1);
    });
  });

  describe('getClassRoster', () => {
    it('should return roster entries with no attendance data', async () => {
      repository.addRosterEntry({
        studentId: STUDENT_ID,
        studentName: 'John Doe',
        enrollmentId: 'enr-001',
        classId: CLASS_ID,
        gradeId: 'grade-001',
      });

      const roster = await service.getClassRoster(TENANT_ID, CLASS_ID, PERIOD_ID, '2024-06-15');

      expect(roster).toHaveLength(1);
      expect(roster[0]!.studentId).toBe(STUDENT_ID);
      expect(roster[0]!.studentName).toBe('John Doe');
      expect(roster[0]!.attendance).toBeUndefined();
    });

    it('should merge existing attendance data with roster', async () => {
      repository.addRosterEntry({
        studentId: STUDENT_ID,
        studentName: 'John Doe',
        enrollmentId: 'enr-001',
        classId: CLASS_ID,
        gradeId: 'grade-001',
      });

      // Record attendance first
      await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      const roster = await service.getClassRoster(TENANT_ID, CLASS_ID, PERIOD_ID, '2024-06-15');

      expect(roster).toHaveLength(1);
      expect(roster[0]!.attendance).toBeDefined();
      expect(roster[0]!.attendance!.status).toBe(AttendanceStatus.PRESENT);
    });

    it('should return multiple students in roster', async () => {
      repository.addRosterEntry({
        studentId: STUDENT_ID,
        studentName: 'John Doe',
        enrollmentId: 'enr-001',
        classId: CLASS_ID,
        gradeId: 'grade-001',
      });
      repository.addRosterEntry({
        studentId: '88888888-8888-4888-8888-888888888888',
        studentName: 'Jane Smith',
        enrollmentId: 'enr-002',
        classId: CLASS_ID,
        gradeId: 'grade-001',
      });

      const roster = await service.getClassRoster(TENANT_ID, CLASS_ID, PERIOD_ID, '2024-06-15');

      expect(roster).toHaveLength(2);
    });
  });

  describe('getAttendanceConfig', () => {
    it('should return institution config when it exists', async () => {
      repository.addInstitutionConfig(createInstitutionConfig('subject'));

      const config = await service.getAttendanceConfig(TENANT_ID, INSTITUTION_ID);

      expect(config.recordingMode).toBe('subject');
      expect(config.leaveTypes).toHaveLength(3);
    });

    it('should return default config when none exists', async () => {
      const config = await service.getAttendanceConfig(TENANT_ID, INSTITUTION_ID);

      expect(config.recordingMode).toBe('class');
      expect(config.leaveTypes).toHaveLength(0);
    });
  });

  describe('validateAttendanceDate', () => {
    it('should accept today', () => {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0]!;
      const periodStart = new Date('2020-01-01');
      const periodEnd = new Date('2099-12-31');

      expect(() => service.validateAttendanceDate(dateStr, periodStart, periodEnd)).not.toThrow();
    });

    it('should accept past dates within period', () => {
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-12-31');

      expect(() =>
        service.validateAttendanceDate('2024-06-15', periodStart, periodEnd),
      ).not.toThrow();
    });

    it('should reject future dates', () => {
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2099-12-31');

      expect(() => service.validateAttendanceDate('2099-12-31', periodStart, periodEnd)).toThrow(
        BusinessRuleError,
      );
    });

    it('should reject dates before period start', () => {
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-12-31');

      expect(() => service.validateAttendanceDate('2023-12-31', periodStart, periodEnd)).toThrow(
        BusinessRuleError,
      );
    });
  });

  describe('validateRecordingMode', () => {
    it('should pass for class mode without extra fields', () => {
      expect(() => service.validateRecordingMode('class')).not.toThrow();
    });

    it('should pass for subject mode with subjectId', () => {
      expect(() => service.validateRecordingMode('subject', SUBJECT_ID)).not.toThrow();
    });

    it('should pass for period mode with periodId', () => {
      expect(() =>
        service.validateRecordingMode('period', undefined, 'period-slot-1'),
      ).not.toThrow();
    });

    it('should fail for subject mode without subjectId', () => {
      expect(() => service.validateRecordingMode('subject')).toThrow(ValidationError);
    });

    it('should fail for period mode without periodId', () => {
      expect(() => service.validateRecordingMode('period')).toThrow(ValidationError);
    });
  });

  describe('recordBulkStudentAttendance', () => {
    it('should record attendance for multiple students', async () => {
      const student2Id = '88888888-8888-4888-8888-888888888888';

      const result = await service.recordBulkStudentAttendance(
        TENANT_ID,
        {
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          records: [
            { studentId: STUDENT_ID, status: 'PRESENT' },
            { studentId: student2Id, status: 'ABSENT', comment: 'Sick' },
          ],
        },
        RECORDED_BY,
      );

      expect(result.recorded).toHaveLength(2);
      expect(result.updated).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should update existing records in bulk operation', async () => {
      // Pre-record attendance
      await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      const result = await service.recordBulkStudentAttendance(
        TENANT_ID,
        {
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          records: [{ studentId: STUDENT_ID, status: 'ABSENT' }],
        },
        RECORDED_BY,
      );

      expect(result.recorded).toHaveLength(0);
      expect(result.updated).toHaveLength(1);
      expect(result.updated[0]!.status).toBe(AttendanceStatus.ABSENT);
    });
  });

  describe('calculateAttendancePercentage', () => {
    const STUDENT_2_ID = '88888888-8888-4888-8888-888888888888';

    async function recordAttendanceForDate(
      studentId: string,
      date: string,
      status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED',
    ) {
      await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date,
          status,
        },
        RECORDED_BY,
      );
    }

    it('should return zero percentage when no records exist', async () => {
      const result = await service.calculateAttendancePercentage(TENANT_ID, {
        scope: 'student',
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result.totalRecords).toBe(0);
      expect(result.attendancePercentage).toBe(0);
      expect(result.absencePercentage).toBe(0);
    });

    it('should calculate student attendance percentage correctly', async () => {
      // 3 present, 1 absent, 1 late = 5 total
      // Attendance = (3 + 1) / 5 * 100 = 80.00%
      await recordAttendanceForDate(STUDENT_ID, '2024-06-10', 'PRESENT');
      await recordAttendanceForDate(STUDENT_ID, '2024-06-11', 'PRESENT');
      await recordAttendanceForDate(STUDENT_ID, '2024-06-12', 'PRESENT');
      await recordAttendanceForDate(STUDENT_ID, '2024-06-13', 'ABSENT');
      await recordAttendanceForDate(STUDENT_ID, '2024-06-14', 'LATE');

      const result = await service.calculateAttendancePercentage(TENANT_ID, {
        scope: 'student',
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result.totalRecords).toBe(5);
      expect(result.presentCount).toBe(3);
      expect(result.absentCount).toBe(1);
      expect(result.lateCount).toBe(1);
      expect(result.attendancePercentage).toBe(80.0);
      expect(result.absencePercentage).toBe(20.0);
    });

    it('should round to exactly two decimal places', async () => {
      // 2 present, 1 absent = 3 total
      // Attendance = 2/3 * 100 = 66.67% (rounded)
      await recordAttendanceForDate(STUDENT_ID, '2024-06-10', 'PRESENT');
      await recordAttendanceForDate(STUDENT_ID, '2024-06-11', 'PRESENT');
      await recordAttendanceForDate(STUDENT_ID, '2024-06-12', 'ABSENT');

      const result = await service.calculateAttendancePercentage(TENANT_ID, {
        scope: 'student',
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result.attendancePercentage).toBe(66.67);
      expect(result.absencePercentage).toBe(33.33);
    });

    it('should calculate class-level attendance percentage', async () => {
      // Student 1: 2 present
      await recordAttendanceForDate(STUDENT_ID, '2024-06-10', 'PRESENT');
      await recordAttendanceForDate(STUDENT_ID, '2024-06-11', 'ABSENT');
      // Student 2: 1 present, 1 absent
      await recordAttendanceForDate(STUDENT_2_ID, '2024-06-10', 'PRESENT');
      await recordAttendanceForDate(STUDENT_2_ID, '2024-06-11', 'PRESENT');

      const result = await service.calculateAttendancePercentage(TENANT_ID, {
        scope: 'class',
        classId: CLASS_ID,
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // 3 present + 1 absent = 4 total, attendance = 3/4 * 100 = 75.00%
      expect(result.totalRecords).toBe(4);
      expect(result.attendancePercentage).toBe(75.0);
      expect(result.absencePercentage).toBe(25.0);
    });

    it('should calculate institution-level attendance percentage', async () => {
      await recordAttendanceForDate(STUDENT_ID, '2024-06-10', 'PRESENT');
      await recordAttendanceForDate(STUDENT_ID, '2024-06-11', 'ABSENT');
      await recordAttendanceForDate(STUDENT_2_ID, '2024-06-10', 'EXCUSED');

      const result = await service.calculateAttendancePercentage(TENANT_ID, {
        scope: 'institution',
        institutionId: INSTITUTION_ID,
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      // 1 present, 1 absent, 1 excused = 3 total
      // Attendance (present + late) = 1/3 * 100 = 33.33%
      expect(result.totalRecords).toBe(3);
      expect(result.attendancePercentage).toBe(33.33);
      expect(result.absencePercentage).toBe(33.33);
      expect(result.excusedCount).toBe(1);
    });

    it('should only include records within the date range', async () => {
      await recordAttendanceForDate(STUDENT_ID, '2024-06-05', 'PRESENT'); // outside range
      await recordAttendanceForDate(STUDENT_ID, '2024-06-10', 'PRESENT'); // inside range
      await recordAttendanceForDate(STUDENT_ID, '2024-06-15', 'ABSENT'); // inside range
      await recordAttendanceForDate(STUDENT_ID, '2024-06-25', 'PRESENT'); // outside range

      const result = await service.calculateAttendancePercentage(TENANT_ID, {
        scope: 'student',
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        startDate: '2024-06-10',
        endDate: '2024-06-20',
      });

      expect(result.totalRecords).toBe(2);
      expect(result.presentCount).toBe(1);
      expect(result.absentCount).toBe(1);
    });

    it('should throw ValidationError for student scope without studentId', async () => {
      await expect(
        service.calculateAttendancePercentage(TENANT_ID, {
          scope: 'student',
          classId: CLASS_ID,
          startDate: '2024-06-01',
          endDate: '2024-06-30',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for class scope without classId', async () => {
      await expect(
        service.calculateAttendancePercentage(TENANT_ID, {
          scope: 'class',
          startDate: '2024-06-01',
          endDate: '2024-06-30',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for institution scope without institutionId', async () => {
      await expect(
        service.calculateAttendancePercentage(TENANT_ID, {
          scope: 'institution',
          startDate: '2024-06-01',
          endDate: '2024-06-30',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError when startDate is after endDate', async () => {
      await expect(
        service.calculateAttendancePercentage(TENANT_ID, {
          scope: 'student',
          studentId: STUDENT_ID,
          classId: CLASS_ID,
          startDate: '2024-06-30',
          endDate: '2024-06-01',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should count LATE as attending for percentage', async () => {
      // All late = 100% attendance
      await recordAttendanceForDate(STUDENT_ID, '2024-06-10', 'LATE');
      await recordAttendanceForDate(STUDENT_ID, '2024-06-11', 'LATE');

      const result = await service.calculateAttendancePercentage(TENANT_ID, {
        scope: 'student',
        studentId: STUDENT_ID,
        classId: CLASS_ID,
        startDate: '2024-06-01',
        endDate: '2024-06-30',
      });

      expect(result.attendancePercentage).toBe(100.0);
      expect(result.absencePercentage).toBe(0);
    });
  });

  describe('checkAbsenceThreshold', () => {
    function createThresholdConfig(
      overrides?: Partial<AbsenceThresholdConfig>,
    ): AbsenceThresholdConfig {
      return {
        institutionId: INSTITUTION_ID,
        tenantId: TENANT_ID,
        threshold: 3,
        evaluationPeriodDays: 30,
        recipientRoleIds: ['role-teacher', 'role-principal'],
        ...overrides,
      };
    }

    it('should return not exceeded when no threshold config exists', async () => {
      const result = await service.checkAbsenceThreshold(TENANT_ID, STUDENT_ID, INSTITUTION_ID);

      expect(result.exceeded).toBe(false);
      expect(result.absenceCount).toBe(0);
      expect(result.threshold).toBe(0);
    });

    it('should return not exceeded when absences are below threshold', async () => {
      repository.addAbsenceThresholdConfig(createThresholdConfig({ threshold: 5 }));

      // Record 3 absences (below threshold of 5)
      const today = new Date();
      for (let i = 1; i <= 3; i++) {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() - i);
        const dateStr = date.toISOString().split('T')[0]!;

        await repository.createStudentAttendance({
          id: `abs-${i}`,
          tenantId: TENANT_ID,
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: dateStr,
          subjectId: null,
          periodId: null,
          status: AttendanceStatus.ABSENT,
          comment: null,
          recordedBy: RECORDED_BY,
        });
      }

      const result = await service.checkAbsenceThreshold(TENANT_ID, STUDENT_ID, INSTITUTION_ID);

      expect(result.exceeded).toBe(false);
      expect(result.absenceCount).toBe(3);
      expect(result.threshold).toBe(5);
    });

    it('should return exceeded when absences exceed threshold', async () => {
      repository.addAbsenceThresholdConfig(createThresholdConfig({ threshold: 2 }));

      // Record 3 absences (above threshold of 2)
      const today = new Date();
      for (let i = 1; i <= 3; i++) {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() - i);
        const dateStr = date.toISOString().split('T')[0]!;

        await repository.createStudentAttendance({
          id: `abs-${i}`,
          tenantId: TENANT_ID,
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: dateStr,
          subjectId: null,
          periodId: null,
          status: AttendanceStatus.ABSENT,
          comment: null,
          recordedBy: RECORDED_BY,
        });
      }

      const result = await service.checkAbsenceThreshold(TENANT_ID, STUDENT_ID, INSTITUTION_ID);

      expect(result.exceeded).toBe(true);
      expect(result.absenceCount).toBe(3);
      expect(result.threshold).toBe(2);
    });

    it('should publish Kafka event when threshold is exceeded', async () => {
      const publishedEvents: AbsenceThresholdExceededEvent[] = [];
      const mockPublisher: AttendanceEventPublisher = {
        publishAbsenceThresholdExceeded: async (event) => {
          publishedEvents.push(event);
        },
      };

      const serviceWithPublisher = new AttendanceService(repository, mockPublisher);
      repository.addAbsenceThresholdConfig(createThresholdConfig({ threshold: 1 }));

      // Record 2 absences (above threshold of 1)
      const today = new Date();
      for (let i = 1; i <= 2; i++) {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() - i);
        const dateStr = date.toISOString().split('T')[0]!;

        await repository.createStudentAttendance({
          id: `abs-${i}`,
          tenantId: TENANT_ID,
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: dateStr,
          subjectId: null,
          periodId: null,
          status: AttendanceStatus.ABSENT,
          comment: null,
          recordedBy: RECORDED_BY,
        });
      }

      await serviceWithPublisher.checkAbsenceThreshold(TENANT_ID, STUDENT_ID, INSTITUTION_ID);

      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]!.tenantId).toBe(TENANT_ID);
      expect(publishedEvents[0]!.studentId).toBe(STUDENT_ID);
      expect(publishedEvents[0]!.institutionId).toBe(INSTITUTION_ID);
      expect(publishedEvents[0]!.absenceCount).toBe(2);
      expect(publishedEvents[0]!.threshold).toBe(1);
      expect(publishedEvents[0]!.recipientRoleIds).toEqual(['role-teacher', 'role-principal']);
    });

    it('should not publish event when threshold is not exceeded', async () => {
      const publishedEvents: AbsenceThresholdExceededEvent[] = [];
      const mockPublisher: AttendanceEventPublisher = {
        publishAbsenceThresholdExceeded: async (event) => {
          publishedEvents.push(event);
        },
      };

      const serviceWithPublisher = new AttendanceService(repository, mockPublisher);
      repository.addAbsenceThresholdConfig(createThresholdConfig({ threshold: 5 }));

      // Record 1 absence (below threshold of 5)
      const today = new Date();
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - 1);
      const dateStr = date.toISOString().split('T')[0]!;

      await repository.createStudentAttendance({
        id: 'abs-1',
        tenantId: TENANT_ID,
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        date: dateStr,
        subjectId: null,
        periodId: null,
        status: AttendanceStatus.ABSENT,
        comment: null,
        recordedBy: RECORDED_BY,
      });

      await serviceWithPublisher.checkAbsenceThreshold(TENANT_ID, STUDENT_ID, INSTITUTION_ID);

      expect(publishedEvents).toHaveLength(0);
    });

    it('should only count absences within the evaluation period', async () => {
      repository.addAbsenceThresholdConfig(
        createThresholdConfig({
          threshold: 2,
          evaluationPeriodDays: 7,
        }),
      );

      // Record 3 absences, but 2 are outside the 7-day evaluation period
      const today = new Date();

      // This one is within the period (2 days ago)
      const recentDate = new Date(today);
      recentDate.setUTCDate(recentDate.getUTCDate() - 2);
      await repository.createStudentAttendance({
        id: 'abs-recent',
        tenantId: TENANT_ID,
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        date: recentDate.toISOString().split('T')[0]!,
        subjectId: null,
        periodId: null,
        status: AttendanceStatus.ABSENT,
        comment: null,
        recordedBy: RECORDED_BY,
      });

      // These are outside the 7-day period (10 and 15 days ago)
      for (const daysAgo of [10, 15]) {
        const oldDate = new Date(today);
        oldDate.setUTCDate(oldDate.getUTCDate() - daysAgo);
        await repository.createStudentAttendance({
          id: `abs-old-${daysAgo}`,
          tenantId: TENANT_ID,
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: oldDate.toISOString().split('T')[0]!,
          subjectId: null,
          periodId: null,
          status: AttendanceStatus.ABSENT,
          comment: null,
          recordedBy: RECORDED_BY,
        });
      }

      const result = await service.checkAbsenceThreshold(TENANT_ID, STUDENT_ID, INSTITUTION_ID);

      // Only 1 absence within the 7-day period, threshold is 2
      expect(result.exceeded).toBe(false);
      expect(result.absenceCount).toBe(1);
    });
  });

  describe('duplicate attendance handling (Req 9.6)', () => {
    it('should update existing record when same student/date/period submitted again', async () => {
      // First submission
      const first = await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      // Duplicate submission with different status
      const second = await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'ABSENT',
          comment: 'Corrected',
        },
        RECORDED_BY,
      );

      // Should be the same record (updated)
      expect(second.id).toBe(first.id);
      expect(second.status).toBe(AttendanceStatus.ABSENT);

      // Only one record should exist
      const records = repository.getStudentAttendanceRecords();
      expect(records).toHaveLength(1);
    });

    it('should maintain audit trail with previous status value', async () => {
      // First submission
      await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      // Second submission (update)
      await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'LATE',
        },
        'user-002',
      );

      // Third submission (another update)
      await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'ABSENT',
        },
        'user-003',
      );

      const auditEntries = repository.getAuditEntries();
      expect(auditEntries).toHaveLength(2);

      // First audit: PRESENT -> LATE
      expect(auditEntries[0]!.previousStatus).toBe(AttendanceStatus.PRESENT);
      expect(auditEntries[0]!.newStatus).toBe(AttendanceStatus.LATE);
      expect(auditEntries[0]!.changedBy).toBe('user-002');

      // Second audit: LATE -> ABSENT
      expect(auditEntries[1]!.previousStatus).toBe(AttendanceStatus.LATE);
      expect(auditEntries[1]!.newStatus).toBe(AttendanceStatus.ABSENT);
      expect(auditEntries[1]!.changedBy).toBe('user-003');
    });

    it('should retrieve audit trail for a specific attendance record', async () => {
      // Record and update
      const record = await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
        RECORDED_BY,
      );

      await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'ABSENT',
        },
        'user-002',
      );

      const auditTrail = await service.getAttendanceAuditTrail(record.id);

      expect(auditTrail).toHaveLength(1);
      expect(auditTrail[0]!.previousStatus).toBe('PRESENT');
      expect(auditTrail[0]!.newStatus).toBe('ABSENT');
      expect(auditTrail[0]!.changedBy).toBe('user-002');
    });
  });
});
