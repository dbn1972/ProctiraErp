/**
 * Prisma Examination Repository
 *
 * Production implementation of {@link ExaminationRepository} backed by
 * PostgreSQL via Prisma, RLS-safe through {@link withTenantTransaction}
 * (tenantId also kept in every `where` clause as defense-in-depth).
 *
 * Schema mapping: the `examinations` table stores the scalar examination
 * fields plus four JSONB columns (`subjects`, `centers`, `sessions`,
 * `grading_schemes`) that hold the entity's nested arrays verbatim. The
 * entity's startDate/endDate are ISO date strings while the columns are
 * `@db.Date` — converted on the way in (`new Date(...)`) and out
 * (`toIsoDate`). Dates *inside* the JSONB arrays (e.g. session.date) are
 * plain strings and pass through untouched.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  CandidateRegistration,
  ExaminationCenter,
  ExaminationEntity,
  ExaminationFilter,
  ExaminationGradingScheme,
  ExaminationRepository,
  ExaminationSession,
  ExaminationSubject,
  StudentEnrollment,
} from './examination-repository.js';

interface ExaminationRow {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  academicPeriodId: string;
  startDate: Date;
  endDate: Date;
  status: string;
  subjects: unknown;
  centers: unknown;
  sessions: unknown;
  gradingSchemes: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface RegistrationRow {
  id: string;
  tenantId: string;
  examinationId: string;
  studentId: string;
  centerId: string;
  subjectIds: unknown;
  status: string;
  registeredAt: Date;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toEntity(row: ExaminationRow): ExaminationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    code: row.code,
    description: row.description,
    academicPeriodId: row.academicPeriodId,
    startDate: toIsoDate(row.startDate),
    endDate: toIsoDate(row.endDate),
    status: row.status as ExaminationEntity['status'],
    subjects: jsonArray<ExaminationSubject>(row.subjects),
    centers: jsonArray<ExaminationCenter>(row.centers),
    sessions: jsonArray<ExaminationSession>(row.sessions),
    gradingSchemes: jsonArray<ExaminationGradingScheme>(row.gradingSchemes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRegistration(row: RegistrationRow): CandidateRegistration {
  return {
    id: row.id,
    tenantId: row.tenantId,
    examinationId: row.examinationId,
    studentId: row.studentId,
    centerId: row.centerId,
    subjectIds: jsonArray<string>(row.subjectIds),
    status: row.status as CandidateRegistration['status'],
    registeredAt: row.registeredAt,
  };
}

const SORTABLE_COLUMNS = new Set([
  'name',
  'code',
  'status',
  'startDate',
  'endDate',
  'academicPeriodId',
  'createdAt',
  'updatedAt',
]);

export class PrismaExaminationRepository implements ExaminationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<ExaminationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ExaminationEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.examination.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          code: data.code,
          description: data.description,
          academicPeriodId: data.academicPeriodId,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
          status: data.status,
          subjects: data.subjects as unknown as Prisma.InputJsonValue,
          centers: data.centers as unknown as Prisma.InputJsonValue,
          sessions: data.sessions as unknown as Prisma.InputJsonValue,
          gradingSchemes: data.gradingSchemes as unknown as Prisma.InputJsonValue,
        },
      })) as ExaminationRow;
      return toEntity(row);
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<ExaminationEntity>,
  ): Promise<ExaminationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.examination.findFirst({
        where: { id, tenantId },
      })) as ExaminationRow | null;
      if (!existing) return null;

      const merged: ExaminationEntity = { ...toEntity(existing) };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (key === 'id' || key === 'tenantId' || key === 'createdAt' || key === 'updatedAt') {
          continue;
        }
        mergedRecord[key] = value;
      }

      const row = (await tx.examination.update({
        where: { id },
        data: {
          name: merged.name,
          code: merged.code,
          description: merged.description,
          academicPeriodId: merged.academicPeriodId,
          startDate: new Date(merged.startDate),
          endDate: new Date(merged.endDate),
          status: merged.status,
          subjects: merged.subjects as unknown as Prisma.InputJsonValue,
          centers: merged.centers as unknown as Prisma.InputJsonValue,
          sessions: merged.sessions as unknown as Prisma.InputJsonValue,
          gradingSchemes: merged.gradingSchemes as unknown as Prisma.InputJsonValue,
        },
      })) as ExaminationRow;
      return toEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<ExaminationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.examination.findFirst({
        where: { id, tenantId },
      })) as ExaminationRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async findByCode(code: string, tenantId: string): Promise<ExaminationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.examination.findFirst({
        where: { code, tenantId },
      })) as ExaminationRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async list(
    tenantId: string,
    filter: ExaminationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ExaminationEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Record<string, unknown> = { tenantId };
      if (filter.academicPeriodId) where['academicPeriodId'] = filter.academicPeriodId;
      if (filter.status) where['status'] = filter.status;
      if (filter.search) {
        where['OR'] = [
          { name: { contains: filter.search, mode: 'insensitive' } },
          { code: { contains: filter.search, mode: 'insensitive' } },
        ];
      }

      const page = Math.max(1, pagination.page);
      const pageSize = Math.max(1, pagination.pageSize);
      const sortBy =
        pagination.sortBy && SORTABLE_COLUMNS.has(pagination.sortBy)
          ? pagination.sortBy
          : 'name';
      const sortOrder = pagination.sortOrder ?? 'asc';

      const [totalItems, rows] = await Promise.all([
        tx.examination.count({ where }),
        tx.examination.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }) as Promise<ExaminationRow[]>,
      ]);

      return {
        data: rows.map(toEntity),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      };
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.examination.deleteMany({
        where: { id, tenantId },
      });
      return result.count > 0;
    });
  }

  /**
   * Cross-domain read against the student domain's `enrollments` table for
   * eligibility validation. The most recent enrollment (by `enrolledAt`,
   * tie-broken by `createdAt`) is treated as the student's current one and
   * its `EnrollmentStatus` enum value is mapped to the lowercase form this
   * interface expects.
   *
   * Integration gap: there is no source for completed subjects in the schema
   * (no completed-subjects/transcript table the enrollment domain exposes),
   * so `completedSubjectCodes` is always `[]`. Prerequisite-based eligibility
   * checks therefore cannot pass until that data source exists.
   */
  async getStudentEnrollment(
    studentId: string,
    tenantId: string,
  ): Promise<StudentEnrollment | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const enrollment = await tx.enrollment.findFirst({
        where: { studentId, tenantId },
        orderBy: [{ enrolledAt: 'desc' }, { createdAt: 'desc' }],
      });
      if (!enrollment) return null;
      return {
        studentId,
        status: enrollment.status.toLowerCase() as StudentEnrollment['status'],
        institutionId: enrollment.institutionId,
        completedSubjectCodes: [],
      };
    });
  }

  async createCandidateRegistration(
    data: CandidateRegistration,
  ): Promise<CandidateRegistration> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.examinationCandidateRegistration.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          examinationId: data.examinationId,
          studentId: data.studentId,
          centerId: data.centerId,
          subjectIds: data.subjectIds as unknown as Prisma.InputJsonValue,
          status: data.status,
          registeredAt: data.registeredAt,
        },
      })) as RegistrationRow;
      return toRegistration(row);
    });
  }

  async findCandidateRegistration(
    examinationId: string,
    studentId: string,
    tenantId: string,
  ): Promise<CandidateRegistration | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.examinationCandidateRegistration.findFirst({
        where: { examinationId, studentId, tenantId },
      })) as RegistrationRow | null;
      return row ? toRegistration(row) : null;
    });
  }

  async listCandidateRegistrations(
    examinationId: string,
    tenantId: string,
  ): Promise<CandidateRegistration[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.examinationCandidateRegistration.findMany({
        where: { examinationId, tenantId },
        orderBy: { registeredAt: 'asc' },
      })) as RegistrationRow[];
      return rows.map(toRegistration);
    });
  }
}
