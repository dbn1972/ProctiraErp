import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type {
  EnrollmentEntity,
  EnrollmentFilter,
  EnrollmentHistoryEntity,
  EnrollmentRepository,
  InstitutionLookup,
  TransferRecordEntity,
} from './enrollment-repository.js';

type EnrollmentStatusValue = EnrollmentEntity['status'];

function toEnrollment(row: {
  id: string;
  tenantId: string;
  studentId: string;
  institutionId: string;
  gradeId: string;
  classId: string | null;
  academicPeriodId: string;
  status: string;
  enrolledAt: Date;
  exitedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): EnrollmentEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    institutionId: row.institutionId,
    gradeId: row.gradeId,
    classId: row.classId,
    academicPeriodId: row.academicPeriodId,
    status: row.status as EnrollmentStatusValue,
    enrolledAt: row.enrolledAt,
    exitedAt: row.exitedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaEnrollmentRepository implements EnrollmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createEnrollment(
    data: Omit<EnrollmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<EnrollmentEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = await tx.enrollment.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          institutionId: data.institutionId,
          gradeId: data.gradeId,
          classId: data.classId,
          academicPeriodId: data.academicPeriodId,
          status: data.status,
          enrolledAt: data.enrolledAt,
          exitedAt: data.exitedAt,
        },
      });
      return toEnrollment(row);
    });
  }

  async updateEnrollment(
    id: string,
    tenantId: string,
    data: Partial<EnrollmentEntity>,
  ): Promise<EnrollmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.enrollment.findFirst({ where: { id, tenantId } });
      if (!existing) return null;
      const row = await tx.enrollment.update({
        where: { id },
        data: {
          ...(data.gradeId !== undefined && { gradeId: data.gradeId }),
          ...(data.classId !== undefined && { classId: data.classId }),
          ...(data.academicPeriodId !== undefined && { academicPeriodId: data.academicPeriodId }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.enrolledAt !== undefined && { enrolledAt: data.enrolledAt }),
          ...(data.exitedAt !== undefined && { exitedAt: data.exitedAt }),
        },
      });
      return toEnrollment(row);
    });
  }

  async findEnrollmentById(id: string, tenantId: string): Promise<EnrollmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = await tx.enrollment.findFirst({ where: { id, tenantId } });
      return row ? toEnrollment(row) : null;
    });
  }

  async listEnrollments(
    tenantId: string,
    filter: EnrollmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<EnrollmentEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = {
        tenantId,
        ...(filter.studentId ? { studentId: filter.studentId } : {}),
        ...(filter.institutionId ? { institutionId: filter.institutionId } : {}),
        ...(filter.academicPeriodId ? { academicPeriodId: filter.academicPeriodId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      };
      const page = Math.max(1, pagination.page ?? 1);
      const pageSize = Math.max(1, Math.min(pagination.pageSize ?? 20, 100));
      const [totalItems, rows] = await Promise.all([
        tx.enrollment.count({ where }),
        tx.enrollment.findMany({
          where,
          orderBy: { enrolledAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        data: rows.map(toEnrollment),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
        },
      };
    });
  }

  async createHistoryEntry(
    data: Omit<EnrollmentHistoryEntity, 'createdAt'>,
  ): Promise<EnrollmentHistoryEntity> {
    const tenantId = data.tenantId;
    if (!tenantId) {
      throw new Error(`Enrollment history for '${data.enrollmentId}' is missing tenantId`);
    }
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = await tx.enrollmentHistory.create({
        data: {
          id: data.id,
          tenantId,
          enrollmentId: data.enrollmentId,
          previousStatus: data.previousStatus,
          newStatus: data.newStatus,
          effectiveDate: data.effectiveDate,
          institutionId: data.institutionId,
          academicPeriodId: data.academicPeriodId,
          reason: data.reason,
        },
      });
      return {
        id: row.id,
        tenantId: row.tenantId,
        enrollmentId: row.enrollmentId,
        previousStatus: row.previousStatus,
        newStatus: row.newStatus,
        effectiveDate: row.effectiveDate,
        institutionId: row.institutionId,
        academicPeriodId: row.academicPeriodId,
        reason: row.reason,
        createdAt: row.createdAt,
      };
    });
  }

  async getEnrollmentHistory(
    tenantId: string,
    studentId: string,
  ): Promise<EnrollmentHistoryEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const enrollments = await tx.enrollment.findMany({
        where: { tenantId, studentId },
        select: { id: true },
      });
      const ids = enrollments.map((item) => item.id);
      if (ids.length === 0) return [];
      const rows = await tx.enrollmentHistory.findMany({
        where: { tenantId, enrollmentId: { in: ids } },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        enrollmentId: row.enrollmentId,
        previousStatus: row.previousStatus,
        newStatus: row.newStatus,
        effectiveDate: row.effectiveDate,
        institutionId: row.institutionId,
        academicPeriodId: row.academicPeriodId,
        reason: row.reason,
        createdAt: row.createdAt,
      }));
    });
  }

  async getHistoryByEnrollmentId(enrollmentId: string): Promise<EnrollmentHistoryEntity[]> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { tenantId: true },
    });
    if (!enrollment) return [];
    return withTenantTransaction(this.prisma, enrollment.tenantId, async (tx) => {
      const rows = await tx.enrollmentHistory.findMany({
        where: { enrollmentId, tenantId: enrollment.tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        enrollmentId: row.enrollmentId,
        previousStatus: row.previousStatus,
        newStatus: row.newStatus,
        effectiveDate: row.effectiveDate,
        institutionId: row.institutionId,
        academicPeriodId: row.academicPeriodId,
        reason: row.reason,
        createdAt: row.createdAt,
      }));
    });
  }

  async createTransferRecord(
    data: Omit<TransferRecordEntity, 'createdAt'>,
  ): Promise<TransferRecordEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = await tx.studentTransfer.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          sourceInstitutionId: data.sourceInstitutionId,
          sourceEnrollmentId: data.sourceEnrollmentId,
          destinationInstitutionId: data.destinationInstitutionId,
          destinationEnrollmentId: data.destinationEnrollmentId,
          transferDate: data.transferDate,
          reason: data.reason,
        },
      });
      return {
        id: row.id,
        tenantId: row.tenantId,
        studentId: row.studentId,
        sourceInstitutionId: row.sourceInstitutionId,
        sourceEnrollmentId: row.sourceEnrollmentId,
        destinationInstitutionId: row.destinationInstitutionId,
        destinationEnrollmentId: row.destinationEnrollmentId,
        transferDate: row.transferDate,
        reason: row.reason,
        createdAt: row.createdAt,
      };
    });
  }

  async getTransferRecords(
    tenantId: string,
    studentId: string,
  ): Promise<TransferRecordEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = await tx.studentTransfer.findMany({
        where: { tenantId, studentId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        studentId: row.studentId,
        sourceInstitutionId: row.sourceInstitutionId,
        sourceEnrollmentId: row.sourceEnrollmentId,
        destinationInstitutionId: row.destinationInstitutionId,
        destinationEnrollmentId: row.destinationEnrollmentId,
        transferDate: row.transferDate,
        reason: row.reason,
        createdAt: row.createdAt,
      }));
    });
  }

  async findInstitutionById(id: string, tenantId: string): Promise<InstitutionLookup | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = await tx.institution.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });
      return row;
    });
  }
}
