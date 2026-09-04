/**
 * Prisma Report Card Repositories
 *
 * Production implementations of report-card template, teacher comment,
 * institution branding, and job repositories. RLS-safe through
 * {@link withTenantTransaction}. All cross-domain ids are bare UUIDs.
 */
import { withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type {
  ReportCardTemplateEntity,
  ReportCardTemplateRepository,
  TeacherCommentEntity,
  TeacherCommentRepository,
  InstitutionBrandingEntity,
  InstitutionBrandingRepository,
  ReportCardJobEntity,
  ReportCardJobRepository,
  ReportCardJobStatus,
} from './report-card-repository.js';

interface ReportCardTemplateRow {
  id: string;
  tenantId: string;
  name: string;
  templateContent: string;
  isDefault: boolean;
  includeLogo: boolean;
  includeGradeSummary: boolean;
  includeComments: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface TeacherCommentRow {
  id: string;
  tenantId: string;
  studentId: string;
  subjectId: string;
  academicPeriodId: string;
  teacherId: string;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}

interface InstitutionBrandingRow {
  institutionId: string;
  tenantId: string;
  name: string;
  logoUrl: string | null;
  address: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

interface ReportCardJobRow {
  id: string;
  tenantId: string;
  studentId: string;
  academicPeriodId: string;
  templateId: string;
  institutionId: string;
  status: string;
  errorMessage: string | null;
  outputUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

function toTemplateEntity(row: ReportCardTemplateRow): ReportCardTemplateEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    templateContent: row.templateContent,
    isDefault: row.isDefault,
    includeLogo: row.includeLogo,
    includeGradeSummary: row.includeGradeSummary,
    includeComments: row.includeComments,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCommentEntity(row: TeacherCommentRow): TeacherCommentEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    subjectId: row.subjectId,
    academicPeriodId: row.academicPeriodId,
    teacherId: row.teacherId,
    comment: row.comment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toBrandingEntity(row: InstitutionBrandingRow): InstitutionBrandingEntity {
  return {
    institutionId: row.institutionId,
    tenantId: row.tenantId,
    name: row.name,
    logoUrl: row.logoUrl,
    address: row.address,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
  };
}

function toJobEntity(row: ReportCardJobRow): ReportCardJobEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    academicPeriodId: row.academicPeriodId,
    templateId: row.templateId,
    institutionId: row.institutionId,
    status: row.status as ReportCardJobStatus,
    errorMessage: row.errorMessage,
    outputUrl: row.outputUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

export class PrismaReportCardTemplateRepository implements ReportCardTemplateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<ReportCardTemplateEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ReportCardTemplateEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.reportCardTemplate.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          templateContent: data.templateContent,
          isDefault: data.isDefault,
          includeLogo: data.includeLogo,
          includeGradeSummary: data.includeGradeSummary,
          includeComments: data.includeComments,
        },
      })) as ReportCardTemplateRow;
      return toTemplateEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<ReportCardTemplateEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.reportCardTemplate.findFirst({
        where: { id, tenantId },
      })) as ReportCardTemplateRow | null;
      return row ? toTemplateEntity(row) : null;
    });
  }

  async findDefault(tenantId: string): Promise<ReportCardTemplateEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.reportCardTemplate.findFirst({
        where: { tenantId, isDefault: true },
      })) as ReportCardTemplateRow | null;
      return row ? toTemplateEntity(row) : null;
    });
  }

  async list(tenantId: string): Promise<ReportCardTemplateEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.reportCardTemplate.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })) as ReportCardTemplateRow[];
      return rows.map(toTemplateEntity);
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<ReportCardTemplateEntity>,
  ): Promise<ReportCardTemplateEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.reportCardTemplate.findFirst({
        where: { id, tenantId },
      })) as ReportCardTemplateRow | null;
      if (!existing) return null;

      const current = toTemplateEntity(existing);
      const merged: ReportCardTemplateEntity = { ...current };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (key === 'id' || key === 'tenantId' || key === 'createdAt' || key === 'updatedAt') {
          continue;
        }
        mergedRecord[key] = value;
      }

      const row = (await tx.reportCardTemplate.update({
        where: { id },
        data: {
          name: merged.name,
          templateContent: merged.templateContent,
          isDefault: merged.isDefault,
          includeLogo: merged.includeLogo,
          includeGradeSummary: merged.includeGradeSummary,
          includeComments: merged.includeComments,
        },
      })) as ReportCardTemplateRow;
      return toTemplateEntity(row);
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.reportCardTemplate.deleteMany({
        where: { id, tenantId },
      });
      return result.count > 0;
    });
  }
}

export class PrismaTeacherCommentRepository implements TeacherCommentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(
    data: Omit<TeacherCommentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TeacherCommentEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const existing = (await tx.teacherComment.findFirst({
        where: {
          tenantId: data.tenantId,
          studentId: data.studentId,
          subjectId: data.subjectId,
          academicPeriodId: data.academicPeriodId,
        },
      })) as TeacherCommentRow | null;

      if (existing) {
        const row = (await tx.teacherComment.update({
          where: { id: existing.id },
          data: {
            teacherId: data.teacherId,
            comment: data.comment,
          },
        })) as TeacherCommentRow;
        return toCommentEntity(row);
      }

      const row = (await tx.teacherComment.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          subjectId: data.subjectId,
          academicPeriodId: data.academicPeriodId,
          teacherId: data.teacherId,
          comment: data.comment,
        },
      })) as TeacherCommentRow;
      return toCommentEntity(row);
    });
  }

  async findByStudentAndPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<TeacherCommentEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.teacherComment.findMany({
        where: { tenantId, studentId, academicPeriodId },
        orderBy: { createdAt: 'asc' },
      })) as TeacherCommentRow[];
      return rows.map(toCommentEntity);
    });
  }

  async findByStudentSubjectPeriod(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<TeacherCommentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.teacherComment.findFirst({
        where: { tenantId, studentId, subjectId, academicPeriodId },
      })) as TeacherCommentRow | null;
      return row ? toCommentEntity(row) : null;
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.teacherComment.deleteMany({
        where: { id, tenantId },
      });
      return result.count > 0;
    });
  }
}

export class PrismaInstitutionBrandingRepository implements InstitutionBrandingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByInstitutionId(
    institutionId: string,
    tenantId: string,
  ): Promise<InstitutionBrandingEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.institutionBranding.findUnique({
        where: {
          tenantId_institutionId: { tenantId, institutionId },
        },
      })) as InstitutionBrandingRow | null;
      return row ? toBrandingEntity(row) : null;
    });
  }
}

export class PrismaReportCardJobRepository implements ReportCardJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<ReportCardJobEntity, 'createdAt' | 'updatedAt' | 'completedAt'>,
  ): Promise<ReportCardJobEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.reportCardJob.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          studentId: data.studentId,
          academicPeriodId: data.academicPeriodId,
          templateId: data.templateId,
          institutionId: data.institutionId,
          status: data.status,
          errorMessage: data.errorMessage,
          outputUrl: data.outputUrl,
        },
      })) as ReportCardJobRow;
      return toJobEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<ReportCardJobEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.reportCardJob.findFirst({
        where: { id, tenantId },
      })) as ReportCardJobRow | null;
      return row ? toJobEntity(row) : null;
    });
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: ReportCardJobStatus,
    details?: { errorMessage?: string; outputUrl?: string; completedAt?: Date },
  ): Promise<ReportCardJobEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.reportCardJob.findFirst({
        where: { id, tenantId },
      })) as ReportCardJobRow | null;
      if (!existing) return null;

      const row = (await tx.reportCardJob.update({
        where: { id },
        data: {
          status,
          ...(details?.errorMessage !== undefined
            ? { errorMessage: details.errorMessage }
            : {}),
          ...(details?.outputUrl !== undefined ? { outputUrl: details.outputUrl } : {}),
          ...(details?.completedAt !== undefined
            ? { completedAt: details.completedAt }
            : {}),
        },
      })) as ReportCardJobRow;
      return toJobEntity(row);
    });
  }

  async findByStudentAndPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<ReportCardJobEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.reportCardJob.findMany({
        where: { tenantId, studentId, academicPeriodId },
        orderBy: { createdAt: 'desc' },
      })) as ReportCardJobRow[];
      return rows.map(toJobEntity);
    });
  }
}
