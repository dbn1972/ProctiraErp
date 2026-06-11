/**
 * Prisma Attendance Repository
 *
 * Production implementation of {@link AttendanceRepository} backed by
 * PostgreSQL via Prisma. Tenant-scoped reads/writes run inside
 * {@link withTenantTransaction} so the `app.current_tenant_id` RLS variable is
 * bound on the same connection that executes the query; `tenantId` is also kept
 * in every `where` clause as defense-in-depth (mirrors PrismaInstitutionRepository).
 *
 * Notes on methods without a dedicated table:
 *  - `getInstitutionAttendanceConfig` / `getAbsenceThresholdConfig` have no
 *    backing schema yet, so they return `null`. The service degrades safely:
 *    it defaults to `recordingMode: 'class'` and treats a null threshold config
 *    as "no alerting configured". Persisting these is a future enhancement.
 *  - `attendance_audit` carries no tenant id and no RLS (the repository contract
 *    provides none on create/read); see the AttendanceAudit note in schema.prisma.
 */
import type { AttendanceStatus } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  AbsenceThresholdConfig,
  AcademicPeriodInfo,
  AttendanceAuditEntry,
  AttendancePercentageQuery,
  AttendanceRepository,
  InstitutionAttendanceConfig,
  StaffAttendanceEntity,
  StudentAttendanceEntity,
  StudentRosterEntry,
} from './attendance-repository.js';

/** `YYYY-MM-DD` string → midnight-UTC Date for a Postgres `DATE` column. */
function toDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Postgres `DATE` value → `YYYY-MM-DD` string. */
function fromDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface StudentAttendanceRow {
  id: string;
  tenantId: string;
  studentId: string;
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  date: Date;
  subjectId: string | null;
  periodId: string | null;
  status: string;
  comment: string | null;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface StaffAttendanceRow {
  id: string;
  tenantId: string;
  staffId: string;
  institutionId: string;
  date: Date;
  status: string;
  leaveTypeId: string | null;
  comment: string | null;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

function toStudentEntity(row: StudentAttendanceRow): StudentAttendanceEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    institutionId: row.institutionId,
    classId: row.classId,
    academicPeriodId: row.academicPeriodId,
    date: fromDateOnly(row.date),
    subjectId: row.subjectId,
    periodId: row.periodId,
    status: row.status as AttendanceStatus,
    comment: row.comment,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStaffEntity(row: StaffAttendanceRow): StaffAttendanceEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    institutionId: row.institutionId,
    date: fromDateOnly(row.date),
    status: row.status as StaffAttendanceEntity['status'],
    leaveTypeId: row.leaveTypeId,
    comment: row.comment,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaAttendanceRepository implements AttendanceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // --- Student attendance ---

  async createStudentAttendance(
    data: Omit<StudentAttendanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StudentAttendanceEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.studentAttendance.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          institutionId: data.institutionId,
          classId: data.classId,
          academicPeriodId: data.academicPeriodId,
          date: toDateOnly(data.date),
          subjectId: data.subjectId,
          periodId: data.periodId,
          status: data.status,
          comment: data.comment,
          recordedBy: data.recordedBy,
        },
      })) as StudentAttendanceRow;
      return toStudentEntity(row);
    });
  }

  async updateStudentAttendance(
    id: string,
    tenantId: string,
    data: Partial<StudentAttendanceEntity>,
  ): Promise<StudentAttendanceEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.studentAttendance.findFirst({
        where: { id, tenantId },
      })) as StudentAttendanceRow | null;
      if (!existing) return null;

      const updateData: Prisma.StudentAttendanceUpdateInput = {};
      if (data.status !== undefined) updateData.status = data.status;
      if (data.comment !== undefined) updateData.comment = data.comment;
      if (data.subjectId !== undefined) updateData.subjectId = data.subjectId;
      if (data.periodId !== undefined) updateData.periodId = data.periodId;
      if (data.recordedBy !== undefined) updateData.recordedBy = data.recordedBy;
      if (data.date !== undefined) updateData.date = toDateOnly(data.date);

      const row = (await tx.studentAttendance.update({
        where: { id },
        data: updateData,
      })) as StudentAttendanceRow;
      return toStudentEntity(row);
    });
  }

  async findStudentAttendance(
    tenantId: string,
    studentId: string,
    classId: string,
    date: string,
    subjectId?: string | null,
    periodId?: string | null,
  ): Promise<StudentAttendanceEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.studentAttendance.findFirst({
        where: {
          tenantId,
          studentId,
          classId,
          date: toDateOnly(date),
          subjectId: subjectId ?? null,
          periodId: periodId ?? null,
        },
      })) as StudentAttendanceRow | null;
      return row ? toStudentEntity(row) : null;
    });
  }

  async listStudentAttendance(
    tenantId: string,
    classId: string,
    date: string,
  ): Promise<StudentAttendanceEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.studentAttendance.findMany({
        where: { tenantId, classId, date: toDateOnly(date) },
      })) as StudentAttendanceRow[];
      return rows.map(toStudentEntity);
    });
  }

  async listStudentAttendanceByDateRange(
    tenantId: string,
    query: AttendancePercentageQuery,
  ): Promise<StudentAttendanceEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.StudentAttendanceWhereInput = {
        tenantId,
        date: { gte: toDateOnly(query.startDate), lte: toDateOnly(query.endDate) },
      };
      if (query.scope === 'student') {
        where.studentId = query.studentId;
        where.classId = query.classId;
      } else if (query.scope === 'class') {
        where.classId = query.classId;
      } else {
        where.institutionId = query.institutionId;
      }

      const rows = (await tx.studentAttendance.findMany({
        where,
      })) as StudentAttendanceRow[];
      return rows.map(toStudentEntity);
    });
  }

  async countStudentAbsences(
    tenantId: string,
    studentId: string,
    institutionId: string,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      return tx.studentAttendance.count({
        where: {
          tenantId,
          studentId,
          institutionId,
          status: 'ABSENT',
          date: { gte: toDateOnly(startDate), lte: toDateOnly(endDate) },
        },
      });
    });
  }

  // --- Staff attendance ---

  async createStaffAttendance(
    data: Omit<StaffAttendanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StaffAttendanceEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.staffAttendance.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          staffId: data.staffId,
          institutionId: data.institutionId,
          date: toDateOnly(data.date),
          status: data.status,
          leaveTypeId: data.leaveTypeId,
          comment: data.comment,
          recordedBy: data.recordedBy,
        },
      })) as StaffAttendanceRow;
      return toStaffEntity(row);
    });
  }

  async updateStaffAttendance(
    id: string,
    tenantId: string,
    data: Partial<StaffAttendanceEntity>,
  ): Promise<StaffAttendanceEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.staffAttendance.findFirst({
        where: { id, tenantId },
      })) as StaffAttendanceRow | null;
      if (!existing) return null;

      const updateData: Prisma.StaffAttendanceUpdateInput = {};
      if (data.status !== undefined) updateData.status = data.status;
      if (data.comment !== undefined) updateData.comment = data.comment;
      if (data.leaveTypeId !== undefined) updateData.leaveTypeId = data.leaveTypeId;
      if (data.recordedBy !== undefined) updateData.recordedBy = data.recordedBy;
      if (data.date !== undefined) updateData.date = toDateOnly(data.date);

      const row = (await tx.staffAttendance.update({
        where: { id },
        data: updateData,
      })) as StaffAttendanceRow;
      return toStaffEntity(row);
    });
  }

  async findStaffAttendance(
    tenantId: string,
    staffId: string,
    date: string,
  ): Promise<StaffAttendanceEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.staffAttendance.findFirst({
        where: { tenantId, staffId, date: toDateOnly(date) },
      })) as StaffAttendanceRow | null;
      return row ? toStaffEntity(row) : null;
    });
  }

  // --- Roster (reads existing enrollment + student tables) ---

  async getClassRoster(
    tenantId: string,
    classId: string,
    academicPeriodId: string,
    _date: string,
  ): Promise<StudentRosterEntry[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const enrollments = await tx.enrollment.findMany({
        where: { tenantId, classId, academicPeriodId, status: 'ENROLLED' },
        include: { student: true },
      });
      return enrollments.map((e) => ({
        studentId: e.studentId,
        studentName: `${e.student.firstName} ${e.student.lastName}`,
        enrollmentId: e.id,
        classId: e.classId ?? classId,
        gradeId: e.gradeId,
      }));
    });
  }

  // --- Academic period (reads existing academic_periods table) ---

  async getActivePeriodForInstitution(
    tenantId: string,
    _institutionId: string,
  ): Promise<AcademicPeriodInfo | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const period = await tx.academicPeriod.findFirst({
        where: { tenantId, status: 'active', deletedAt: null },
        orderBy: { startDate: 'desc' },
      });
      return period
        ? {
            id: period.id,
            tenantId: period.tenantId,
            name: period.name,
            startDate: period.startDate,
            endDate: period.endDate,
            status: period.status,
          }
        : null;
    });
  }

  async getAcademicPeriodById(
    tenantId: string,
    periodId: string,
  ): Promise<AcademicPeriodInfo | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const period = await tx.academicPeriod.findFirst({
        where: { id: periodId, tenantId, deletedAt: null },
      });
      return period
        ? {
            id: period.id,
            tenantId: period.tenantId,
            name: period.name,
            startDate: period.startDate,
            endDate: period.endDate,
            status: period.status,
          }
        : null;
    });
  }

  // --- Config (no backing table yet — service degrades safely) ---

  async getInstitutionAttendanceConfig(
    _tenantId: string,
    _institutionId: string,
  ): Promise<InstitutionAttendanceConfig | null> {
    return null;
  }

  async getAbsenceThresholdConfig(
    _tenantId: string,
    _institutionId: string,
  ): Promise<AbsenceThresholdConfig | null> {
    return null;
  }

  // --- Audit (append-only, no RLS — see schema.prisma note) ---

  async createAuditEntry(entry: AttendanceAuditEntry): Promise<void> {
    await this.prisma.attendanceAudit.create({
      data: {
        id: entry.id,
        attendanceId: entry.attendanceId,
        previousStatus: entry.previousStatus,
        newStatus: entry.newStatus,
        changedBy: entry.changedBy,
        changedAt: entry.changedAt,
      },
    });
  }

  async getAuditEntriesForAttendance(
    attendanceId: string,
  ): Promise<AttendanceAuditEntry[]> {
    const rows = await this.prisma.attendanceAudit.findMany({
      where: { attendanceId },
      orderBy: { changedAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      attendanceId: r.attendanceId,
      previousStatus: r.previousStatus as AttendanceStatus | null,
      newStatus: r.newStatus as AttendanceStatus,
      changedBy: r.changedBy,
      changedAt: r.changedAt,
    }));
  }
}
