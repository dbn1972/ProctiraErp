/**
 * In-Memory Attendance Repository
 *
 * Used for unit testing without database dependencies.
 */
import { AttendanceStatus } from '@proctira/common';

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

/**
 * In-memory implementation of AttendanceRepository for testing.
 */
export class InMemoryAttendanceRepository implements AttendanceRepository {
  private studentAttendance: StudentAttendanceEntity[] = [];
  private staffAttendance: StaffAttendanceEntity[] = [];
  private rosterEntries: StudentRosterEntry[] = [];
  private academicPeriods: AcademicPeriodInfo[] = [];
  private institutionConfigs: InstitutionAttendanceConfig[] = [];
  private auditEntries: AttendanceAuditEntry[] = [];
  private absenceThresholdConfigs: AbsenceThresholdConfig[] = [];

  // --- Setup helpers for tests ---

  addRosterEntry(entry: StudentRosterEntry): void {
    this.rosterEntries.push(entry);
  }

  addAcademicPeriod(period: AcademicPeriodInfo): void {
    this.academicPeriods.push(period);
  }

  addInstitutionConfig(config: InstitutionAttendanceConfig): void {
    this.institutionConfigs.push(config);
  }

  addAbsenceThresholdConfig(config: AbsenceThresholdConfig): void {
    this.absenceThresholdConfigs.push(config);
  }

  getAuditEntries(): AttendanceAuditEntry[] {
    return [...this.auditEntries];
  }

  getStudentAttendanceRecords(): StudentAttendanceEntity[] {
    return [...this.studentAttendance];
  }

  getStaffAttendanceRecords(): StaffAttendanceEntity[] {
    return [...this.staffAttendance];
  }

  clear(): void {
    this.studentAttendance = [];
    this.staffAttendance = [];
    this.rosterEntries = [];
    this.academicPeriods = [];
    this.institutionConfigs = [];
    this.auditEntries = [];
    this.absenceThresholdConfigs = [];
  }

  // --- Student Attendance ---

  async createStudentAttendance(
    data: Omit<StudentAttendanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StudentAttendanceEntity> {
    const entity: StudentAttendanceEntity = {
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.studentAttendance.push(entity);
    return entity;
  }

  async updateStudentAttendance(
    id: string,
    tenantId: string,
    data: Partial<StudentAttendanceEntity>,
  ): Promise<StudentAttendanceEntity | null> {
    const index = this.studentAttendance.findIndex((r) => r.id === id && r.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.studentAttendance[index]!;
    this.studentAttendance[index] = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    return this.studentAttendance[index];
  }

  async findStudentAttendance(
    tenantId: string,
    studentId: string,
    classId: string,
    date: string,
    subjectId?: string | null,
    periodId?: string | null,
  ): Promise<StudentAttendanceEntity | null> {
    return (
      this.studentAttendance.find(
        (r) =>
          r.tenantId === tenantId &&
          r.studentId === studentId &&
          r.classId === classId &&
          r.date === date &&
          r.subjectId === (subjectId ?? null) &&
          r.periodId === (periodId ?? null),
      ) ?? null
    );
  }

  async listStudentAttendance(
    tenantId: string,
    classId: string,
    date: string,
  ): Promise<StudentAttendanceEntity[]> {
    return this.studentAttendance.filter(
      (r) => r.tenantId === tenantId && r.classId === classId && r.date === date,
    );
  }

  // --- Staff Attendance ---

  async createStaffAttendance(
    data: Omit<StaffAttendanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StaffAttendanceEntity> {
    const entity: StaffAttendanceEntity = {
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.staffAttendance.push(entity);
    return entity;
  }

  async updateStaffAttendance(
    id: string,
    tenantId: string,
    data: Partial<StaffAttendanceEntity>,
  ): Promise<StaffAttendanceEntity | null> {
    const index = this.staffAttendance.findIndex((r) => r.id === id && r.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.staffAttendance[index]!;
    this.staffAttendance[index] = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    return this.staffAttendance[index];
  }

  async findStaffAttendance(
    tenantId: string,
    staffId: string,
    date: string,
  ): Promise<StaffAttendanceEntity | null> {
    return (
      this.staffAttendance.find(
        (r) => r.tenantId === tenantId && r.staffId === staffId && r.date === date,
      ) ?? null
    );
  }

  // --- Roster ---

  async getClassRoster(
    tenantId: string,
    classId: string,
    _academicPeriodId: string,
    _date: string,
  ): Promise<StudentRosterEntry[]> {
    return this.rosterEntries.filter((r) => r.classId === classId);
  }

  // --- Academic Period ---

  async getActivePeriodForInstitution(
    tenantId: string,
    _institutionId: string,
  ): Promise<AcademicPeriodInfo | null> {
    return (
      this.academicPeriods.find((p) => p.tenantId === tenantId && p.status === 'active') ?? null
    );
  }

  async getAcademicPeriodById(
    tenantId: string,
    periodId: string,
  ): Promise<AcademicPeriodInfo | null> {
    return this.academicPeriods.find((p) => p.tenantId === tenantId && p.id === periodId) ?? null;
  }

  // --- Institution Config ---

  async getInstitutionAttendanceConfig(
    tenantId: string,
    institutionId: string,
  ): Promise<InstitutionAttendanceConfig | null> {
    return (
      this.institutionConfigs.find(
        (c) => c.tenantId === tenantId && c.institutionId === institutionId,
      ) ?? null
    );
  }

  // --- Absence Threshold Config ---

  async getAbsenceThresholdConfig(
    tenantId: string,
    institutionId: string,
  ): Promise<AbsenceThresholdConfig | null> {
    return (
      this.absenceThresholdConfigs.find(
        (c) => c.tenantId === tenantId && c.institutionId === institutionId,
      ) ?? null
    );
  }

  // --- Attendance by date range ---

  async listStudentAttendanceByDateRange(
    tenantId: string,
    query: AttendancePercentageQuery,
  ): Promise<StudentAttendanceEntity[]> {
    return this.studentAttendance.filter((r) => {
      if (r.tenantId !== tenantId) return false;
      if (r.date < query.startDate || r.date > query.endDate) return false;

      switch (query.scope) {
        case 'student':
          return r.studentId === query.studentId && r.classId === query.classId;
        case 'class':
          return r.classId === query.classId;
        case 'institution':
          return r.institutionId === query.institutionId;
        default:
          return false;
      }
    });
  }

  // --- Count absences ---

  async countStudentAbsences(
    tenantId: string,
    studentId: string,
    institutionId: string,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    return this.studentAttendance.filter(
      (r) =>
        r.tenantId === tenantId &&
        r.studentId === studentId &&
        r.institutionId === institutionId &&
        r.date >= startDate &&
        r.date <= endDate &&
        r.status === AttendanceStatus.ABSENT,
    ).length;
  }

  // --- Audit ---

  async createAuditEntry(entry: AttendanceAuditEntry): Promise<void> {
    this.auditEntries.push(entry);
  }

  async getAuditEntriesForAttendance(
    attendanceId: string,
    tenantId?: string,
  ): Promise<AttendanceAuditEntry[]> {
    return this.auditEntries.filter(
      (e) =>
        e.attendanceId === attendanceId && (!tenantId || !e.tenantId || e.tenantId === tenantId),
    );
  }
}
