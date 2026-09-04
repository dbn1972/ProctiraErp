/**
 * Prisma Survey Repositories
 *
 * Production implementations of SurveyRepository, DistributionRepository,
 * SubmissionRepository, and InstitutionLookup backed by PostgreSQL via Prisma.
 * Tenant-scoped work runs inside {@link withTenantTransaction}.
 *
 * InstitutionLookup reads the institution schema (Institution + GeographicArea).
 * Classification filtering is best-effort: the Institution model has no
 * classification column, so `classificationIds` is ignored when querying Prisma
 * (callers can still use InMemoryInstitutionLookup in tests).
 */
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type { CompletionStatus, SurveyStatus } from './schemas.js';
import type {
  AnswerEntity,
  DistributionRecordEntity,
  DistributionRepository,
  InstitutionLookup,
  InstitutionMetadata,
  QuestionEntity,
  SubmissionEntity,
  SubmissionRepository,
  SurveyEntity,
  SurveyFilter,
  SurveyRepository,
} from './survey-repository.js';

// ─── Row / mapper helpers ────────────────────────────────────────────────────

interface SurveyRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: string;
  academicPeriodId: string | null;
  startDate: string | null;
  endDate: string | null;
  questions: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface DistributionRow {
  id: string;
  tenantId: string;
  surveyId: string;
  institutionId: string;
  status: string;
  dueDate: string | null;
  submittedAt: string | null;
  remindersSent: number;
  reminderDays: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface SubmissionRow {
  id: string;
  tenantId: string;
  surveyId: string;
  institutionId: string;
  answers: unknown;
  submittedAt: Date;
  createdAt: Date;
}

function asQuestions(value: unknown): QuestionEntity[] {
  return Array.isArray(value) ? (value as QuestionEntity[]) : [];
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
}

function asAnswers(value: unknown): AnswerEntity[] {
  return Array.isArray(value) ? (value as AnswerEntity[]) : [];
}

function toSurvey(row: SurveyRow): SurveyEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    status: row.status as SurveyStatus,
    academicPeriodId: row.academicPeriodId,
    startDate: row.startDate,
    endDate: row.endDate,
    questions: asQuestions(row.questions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDistribution(row: DistributionRow): DistributionRecordEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    surveyId: row.surveyId,
    institutionId: row.institutionId,
    status: row.status as CompletionStatus,
    dueDate: row.dueDate,
    submittedAt: row.submittedAt,
    remindersSent: row.remindersSent,
    reminderDays: asNumberArray(row.reminderDays),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSubmission(row: SubmissionRow): SubmissionEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    surveyId: row.surveyId,
    institutionId: row.institutionId,
    answers: asAnswers(row.answers),
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
  };
}

// ─── Survey ──────────────────────────────────────────────────────────────────

export class PrismaSurveyRepository implements SurveyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<SurveyEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SurveyEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.survey.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          description: data.description,
          status: data.status,
          academicPeriodId: data.academicPeriodId,
          startDate: data.startDate,
          endDate: data.endDate,
          questions: data.questions as unknown as Prisma.InputJsonValue,
        },
      })) as SurveyRow;
      return toSurvey(row);
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<Omit<SurveyEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<SurveyEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.survey.findFirst({
        where: { id, tenantId },
      })) as SurveyRow | null;
      if (!existing) return null;

      const updateData: Prisma.SurveyUpdateInput = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.academicPeriodId !== undefined) {
        updateData.academicPeriodId = data.academicPeriodId;
      }
      if (data.startDate !== undefined) updateData.startDate = data.startDate;
      if (data.endDate !== undefined) updateData.endDate = data.endDate;
      if (data.questions !== undefined) {
        updateData.questions = data.questions as unknown as Prisma.InputJsonValue;
      }

      const row = (await tx.survey.update({
        where: { id },
        data: updateData,
      })) as SurveyRow;
      return toSurvey(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<SurveyEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.survey.findFirst({
        where: { id, tenantId },
      })) as SurveyRow | null;
      return row ? toSurvey(row) : null;
    });
  }

  async findByName(name: string, tenantId: string): Promise<SurveyEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.survey.findFirst({
        where: { name, tenantId },
      })) as SurveyRow | null;
      return row ? toSurvey(row) : null;
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.survey.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.survey.delete({ where: { id } });
      return true;
    });
  }

  async list(
    tenantId: string,
    filter: SurveyFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SurveyEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.SurveyWhereInput = { tenantId };
      if (filter.status) where.status = filter.status;
      if (filter.search) {
        where.name = { contains: filter.search, mode: 'insensitive' };
      }

      const totalItems = await tx.survey.count({ where });
      const totalPages = Math.ceil(totalItems / pagination.pageSize) || 0;
      const rows = (await tx.survey.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      })) as SurveyRow[];

      return {
        data: rows.map(toSurvey),
        meta: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          totalItems,
          totalPages,
        },
      };
    });
  }
}

// ─── Distribution ────────────────────────────────────────────────────────────

export class PrismaDistributionRepository implements DistributionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createMany(
    records: Omit<DistributionRecordEntity, 'createdAt' | 'updatedAt'>[],
  ): Promise<DistributionRecordEntity[]> {
    if (records.length === 0) return [];
    const tenantId = records[0]!.tenantId;
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const created: DistributionRecordEntity[] = [];
      for (const record of records) {
        const row = (await tx.surveyDistribution.create({
          data: {
            id: record.id,
            tenantId: record.tenantId,
            surveyId: record.surveyId,
            institutionId: record.institutionId,
            status: record.status,
            dueDate: record.dueDate,
            submittedAt: record.submittedAt,
            remindersSent: record.remindersSent,
            reminderDays: record.reminderDays as Prisma.InputJsonValue,
          },
        })) as DistributionRow;
        created.push(toDistribution(row));
      }
      return created;
    });
  }

  async findBySurveyAndInstitution(
    tenantId: string,
    surveyId: string,
    institutionId: string,
  ): Promise<DistributionRecordEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.surveyDistribution.findFirst({
        where: { tenantId, surveyId, institutionId },
      })) as DistributionRow | null;
      return row ? toDistribution(row) : null;
    });
  }

  async findBySurvey(
    tenantId: string,
    surveyId: string,
  ): Promise<DistributionRecordEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.surveyDistribution.findMany({
        where: { tenantId, surveyId },
      })) as DistributionRow[];
      return rows.map(toDistribution);
    });
  }

  async findIncompleteBySurvey(
    tenantId: string,
    surveyId: string,
  ): Promise<DistributionRecordEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.surveyDistribution.findMany({
        where: { tenantId, surveyId, status: { not: 'completed' } },
      })) as DistributionRow[];
      return rows.map(toDistribution);
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<Pick<DistributionRecordEntity, 'status' | 'submittedAt' | 'remindersSent'>>,
  ): Promise<DistributionRecordEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.surveyDistribution.findFirst({
        where: { id, tenantId },
      })) as DistributionRow | null;
      if (!existing) return null;

      const updateData: Prisma.SurveyDistributionUpdateInput = {};
      if (data.status !== undefined) updateData.status = data.status;
      if (data.submittedAt !== undefined) updateData.submittedAt = data.submittedAt;
      if (data.remindersSent !== undefined) {
        updateData.remindersSent = data.remindersSent;
      }

      const row = (await tx.surveyDistribution.update({
        where: { id },
        data: updateData,
      })) as DistributionRow;
      return toDistribution(row);
    });
  }

  async countByStatus(
    tenantId: string,
    surveyId: string,
  ): Promise<Record<CompletionStatus, number>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = await tx.surveyDistribution.groupBy({
        by: ['status'],
        where: { tenantId, surveyId },
        _count: { _all: true },
      });
      const counts: Record<CompletionStatus, number> = {
        pending: 0,
        in_progress: 0,
        completed: 0,
      };
      for (const row of rows) {
        const status = row.status as CompletionStatus;
        if (status in counts) {
          counts[status] = row._count._all;
        }
      }
      return counts;
    });
  }
}

// ─── Submission ──────────────────────────────────────────────────────────────

export class PrismaSubmissionRepository implements SubmissionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: Omit<SubmissionEntity, 'createdAt'>): Promise<SubmissionEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.surveySubmission.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          surveyId: data.surveyId,
          institutionId: data.institutionId,
          answers: data.answers as unknown as Prisma.InputJsonValue,
          submittedAt: data.submittedAt,
        },
      })) as SubmissionRow;
      return toSubmission(row);
    });
  }

  async findBySurvey(tenantId: string, surveyId: string): Promise<SubmissionEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.surveySubmission.findMany({
        where: { tenantId, surveyId },
      })) as SubmissionRow[];
      return rows.map(toSubmission);
    });
  }

  async findBySurveyAndInstitution(
    tenantId: string,
    surveyId: string,
    institutionId: string,
  ): Promise<SubmissionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.surveySubmission.findFirst({
        where: { tenantId, surveyId, institutionId },
      })) as SubmissionRow | null;
      return row ? toSubmission(row) : null;
    });
  }
}

// ─── Institution Lookup ──────────────────────────────────────────────────────

interface InstitutionLookupRow {
  id: string;
  name: string;
  areaId: string;
  type: string;
  area: { name: string } | null;
}

export class PrismaInstitutionLookup implements InstitutionLookup {
  constructor(private readonly prisma: PrismaClient) {}

  async findByFilters(
    tenantId: string,
    filters: {
      areaIds?: string[];
      institutionTypeIds?: string[];
      classificationIds?: string[];
    },
  ): Promise<string[]> {
    // classificationIds ignored — Institution has no classification column.
    void filters.classificationIds;
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.InstitutionWhereInput = {
        tenantId,
        deletedAt: null,
      };
      if (filters.areaIds && filters.areaIds.length > 0) {
        where.areaId = { in: filters.areaIds };
      }
      if (filters.institutionTypeIds && filters.institutionTypeIds.length > 0) {
        where.type = { in: filters.institutionTypeIds };
      }
      const rows = await tx.institution.findMany({
        where,
        select: { id: true },
      });
      return rows.map((r) => r.id);
    });
  }

  async getMetadata(
    tenantId: string,
    institutionIds: string[],
  ): Promise<InstitutionMetadata[]> {
    if (institutionIds.length === 0) return [];
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.institution.findMany({
        where: {
          tenantId,
          id: { in: institutionIds },
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          areaId: true,
          type: true,
          area: { select: { name: true } },
        },
      })) as InstitutionLookupRow[];

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        areaId: r.areaId,
        areaName: r.area?.name ?? '',
        typeId: r.type,
        typeName: r.type,
      }));
    });
  }
}
