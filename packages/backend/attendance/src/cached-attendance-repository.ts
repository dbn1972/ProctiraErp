/**
 * Cached Attendance Repository Decorator
 *
 * Wraps any AttendanceRepository implementation with a Redis-backed cache layer.
 * Caches the class roster (getClassRoster) with a 1-hour TTL since rosters
 * change infrequently. Invalidates when enrollment changes affect the roster.
 * If no CacheClient is provided, all operations pass through to the delegate.
 */
import type { CacheClient } from '@proctira/cache';
import { tenantKey } from '@proctira/cache';

import type {
  AttendanceRepository,
  StudentAttendanceEntity,
  StaffAttendanceEntity,
  StudentRosterEntry,
  AcademicPeriodInfo,
  InstitutionAttendanceConfig,
  AttendanceAuditEntry,
  AttendancePercentageQuery,
  AbsenceThresholdConfig,
} from './attendance-repository.js';

/** TTL for class roster cache (1 hour — rosters change infrequently) */
const ROSTER_TTL_SECONDS = 3600;

export class CachedAttendanceRepository implements AttendanceRepository {
  constructor(
    private readonly delegate: AttendanceRepository,
    private readonly cache?: CacheClient,
  ) {}

  // --- Student Attendance (not cached — high write frequency) ---

  async createStudentAttendance(
    data: Omit<StudentAttendanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StudentAttendanceEntity> {
    return this.delegate.createStudentAttendance(data);
  }

  async updateStudentAttendance(
    id: string,
    tenantId: string,
    data: Partial<StudentAttendanceEntity>,
  ): Promise<StudentAttendanceEntity | null> {
    return this.delegate.updateStudentAttendance(id, tenantId, data);
  }

  async findStudentAttendance(
    tenantId: string,
    studentId: string,
    classId: string,
    date: string,
    subjectId?: string | null,
    periodId?: string | null,
  ): Promise<StudentAttendanceEntity | null> {
    return this.delegate.findStudentAttendance(
      tenantId,
      studentId,
      classId,
      date,
      subjectId,
      periodId,
    );
  }

  async listStudentAttendance(
    tenantId: string,
    classId: string,
    date: string,
  ): Promise<StudentAttendanceEntity[]> {
    return this.delegate.listStudentAttendance(tenantId, classId, date);
  }

  async listStudentAttendanceByDateRange(
    tenantId: string,
    query: AttendancePercentageQuery,
  ): Promise<StudentAttendanceEntity[]> {
    return this.delegate.listStudentAttendanceByDateRange(tenantId, query);
  }

  async listStudentAttendanceByStudentDateRange(
    tenantId: string,
    studentId: string,
    startDate: string,
    endDate: string,
  ): Promise<StudentAttendanceEntity[]> {
    return this.delegate.listStudentAttendanceByStudentDateRange(
      tenantId,
      studentId,
      startDate,
      endDate,
    );
  }

  async countStudentAbsences(
    tenantId: string,
    studentId: string,
    institutionId: string,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    return this.delegate.countStudentAbsences(
      tenantId,
      studentId,
      institutionId,
      startDate,
      endDate,
    );
  }

  // --- Staff Attendance (not cached) ---

  async createStaffAttendance(
    data: Omit<StaffAttendanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StaffAttendanceEntity> {
    return this.delegate.createStaffAttendance(data);
  }

  async updateStaffAttendance(
    id: string,
    tenantId: string,
    data: Partial<StaffAttendanceEntity>,
  ): Promise<StaffAttendanceEntity | null> {
    return this.delegate.updateStaffAttendance(id, tenantId, data);
  }

  async findStaffAttendance(
    tenantId: string,
    staffId: string,
    date: string,
  ): Promise<StaffAttendanceEntity | null> {
    return this.delegate.findStaffAttendance(tenantId, staffId, date);
  }

  // --- Roster (CACHED — 1 hour TTL) ---

  async getClassRoster(
    tenantId: string,
    classId: string,
    academicPeriodId: string,
    date: string,
  ): Promise<StudentRosterEntry[]> {
    if (!this.cache) {
      return this.delegate.getClassRoster(tenantId, classId, academicPeriodId, date);
    }

    const key = tenantKey(tenantId, 'roster', `${classId}:${academicPeriodId}`);
    return this.cache.getOrSet(
      key,
      () => this.delegate.getClassRoster(tenantId, classId, academicPeriodId, date),
      ROSTER_TTL_SECONDS,
    );
  }

  /**
   * Invalidate the cached roster for a class.
   * Call this when enrollment changes (student added/removed from class).
   */
  async invalidateClassRoster(
    tenantId: string,
    classId: string,
    academicPeriodId: string,
  ): Promise<void> {
    if (!this.cache) return;
    const key = tenantKey(tenantId, 'roster', `${classId}:${academicPeriodId}`);
    await this.cache.del(key);
  }

  // --- Academic Period (not cached — infrequent reads, rarely changes) ---

  async getActivePeriodForInstitution(
    tenantId: string,
    institutionId: string,
  ): Promise<AcademicPeriodInfo | null> {
    return this.delegate.getActivePeriodForInstitution(tenantId, institutionId);
  }

  async getAcademicPeriodById(
    tenantId: string,
    periodId: string,
  ): Promise<AcademicPeriodInfo | null> {
    return this.delegate.getAcademicPeriodById(tenantId, periodId);
  }

  // --- Institution Config (not cached) ---

  async getInstitutionAttendanceConfig(
    tenantId: string,
    institutionId: string,
  ): Promise<InstitutionAttendanceConfig | null> {
    return this.delegate.getInstitutionAttendanceConfig(tenantId, institutionId);
  }

  // --- Absence Threshold Config ---

  async getAbsenceThresholdConfig(
    tenantId: string,
    institutionId: string,
  ): Promise<AbsenceThresholdConfig | null> {
    return this.delegate.getAbsenceThresholdConfig(tenantId, institutionId);
  }

  // --- Audit (not cached) ---

  async createAuditEntry(entry: AttendanceAuditEntry): Promise<void> {
    return this.delegate.createAuditEntry(entry);
  }

  async getAuditEntriesForAttendance(
    attendanceId: string,
    tenantId?: string,
  ): Promise<AttendanceAuditEntry[]> {
    return this.delegate.getAuditEntriesForAttendance(attendanceId, tenantId);
  }
}
