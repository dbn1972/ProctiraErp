/**
 * In-Memory Attendance Repository
 *
 * Used for unit testing without database dependencies.
 */
import { AttendanceStatus, ConflictError, NotFoundError } from '@proctira/common';

import type {
  AttendanceRepository,
  AttendanceWriteOp,
  StudentAttendanceEntity,
  StaffAttendanceEntity,
  StudentRosterEntry,
  AcademicPeriodInfo,
  InstitutionAttendanceConfig,
  AttendanceAuditEntry,
  AttendancePercentageQuery,
  AttendanceStatusCount,
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

  async findStudentAttendanceById(
    tenantId: string,
    id: string,
  ): Promise<StudentAttendanceEntity | null> {
    return this.studentAttendance.find((r) => r.id === id && r.tenantId === tenantId) ?? null;
  }

  /** Test hook: throw from the Nth audit insert inside a write batch (fault injection). */
  failAuditOnCall: number | null = null;
  private auditCalls = 0;

  /** All-or-nothing (PRC-M168): snapshot, apply, restore on any failure. */
  async applyStudentAttendanceWrites(
    tenantId: string,
    ops: AttendanceWriteOp[],
  ): Promise<StudentAttendanceEntity[]> {
    const snapRows = this.studentAttendance.map((r) => ({ ...r }));
    const snapAudit = [...this.auditEntries];
    const pushAudit = (entry: AttendanceAuditEntry) => {
      this.auditCalls += 1;
      if (this.failAuditOnCall !== null && this.auditCalls === this.failAuditOnCall) {
        throw new Error('injected audit failure');
      }
      this.auditEntries.push(entry);
    };
    try {
      const out: StudentAttendanceEntity[] = [];
      for (const op of ops) {
        if (op.kind === 'create') {
          const entity: StudentAttendanceEntity = {
            ...op.data,
            tenantId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.studentAttendance.push(entity);
          if (op.audit)
            pushAudit({ ...op.audit, tenantId, attendanceId: entity.id, previousStatus: null });
          out.push(entity);
          continue;
        }
        const index = this.studentAttendance.findIndex(
          (r) => r.id === op.id && r.tenantId === tenantId,
        );
        if (index === -1) throw new NotFoundError(`Attendance record '${op.id}' not found`);
        const current = this.studentAttendance[index]!;
        if (op.expectedStatus !== undefined && current.status !== op.expectedStatus) {
          throw new ConflictError(`Attendance record '${op.id}' changed since the request`);
        }
        const next = { ...current, ...op.data, id: current.id, tenantId, updatedAt: new Date() };
        this.studentAttendance[index] = next;
        if (op.audit && (!op.auditOnlyOnStatusChange || current.status !== next.status)) {
          pushAudit({
            ...op.audit,
            tenantId,
            attendanceId: op.id,
            previousStatus: current.status,
          });
        }
        out.push(next);
      }
      return out;
    } catch (err) {
      this.studentAttendance = snapRows;
      this.auditEntries = snapAudit;
      throw err;
    }
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
    const asOf = new Date();
    const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
    return (
      this.academicPeriods.find((p) => {
        if (p.tenantId !== tenantId || p.status !== 'active') return false;
        const start = Date.UTC(
          p.startDate.getUTCFullYear(),
          p.startDate.getUTCMonth(),
          p.startDate.getUTCDate(),
        );
        const end = Date.UTC(
          p.endDate.getUTCFullYear(),
          p.endDate.getUTCMonth(),
          p.endDate.getUTCDate(),
        );
        return start <= asOfDay && asOfDay <= end;
      }) ?? null
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

  async countStudentAttendanceByStatus(
    tenantId: string,
    query: AttendancePercentageQuery,
  ): Promise<AttendanceStatusCount[]> {
    const buckets = new Map<string, AttendanceStatusCount>();
    for (const r of await this.listStudentAttendanceByDateRange(tenantId, query)) {
      const key = `${r.studentId}\u0000${r.status}`;
      const b = buckets.get(key) ?? { studentId: r.studentId, status: r.status, count: 0 };
      b.count += 1;
      buckets.set(key, b);
    }
    return [...buckets.values()];
  }

  async listStudentAttendanceByStudentDateRange(
    tenantId: string,
    studentId: string,
    startDate: string,
    endDate: string,
  ): Promise<StudentAttendanceEntity[]> {
    return this.studentAttendance.filter(
      (r) =>
        r.tenantId === tenantId &&
        r.studentId === studentId &&
        r.date >= startDate &&
        r.date <= endDate,
    );
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
