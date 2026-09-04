/**
 * Prisma Staff Appraisal Repositories
 *
 * Production implementations of {@link AppraisalTemplateRepository} and
 * {@link AppraisalRepository} backed by PostgreSQL via Prisma (tables
 * `staff_appraisal_templates` / `staff_appraisals`), RLS-safe through
 * {@link withTenantTransaction}.
 *
 * JSONB round-trips: `criteria` and `scores` arrays.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  AppraisalCriterionEntity,
  AppraisalScoreEntity,
  AppraisalTemplateEntity,
  AppraisalEntity,
  AppraisalFilter,
  AppraisalTemplateRepository,
  AppraisalRepository,
} from './appraisal-repository.js';

interface AppraisalTemplateRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  academicPeriodId: string;
  criteria: unknown;
  scoreMin: number;
  scoreMax: number;
  createdAt: Date;
  updatedAt: Date;
}

interface AppraisalRow {
  id: string;
  tenantId: string;
  staffId: string;
  templateId: string;
  appraisalDate: string;
  scores: unknown;
  totalScore: number;
  overallComment: string | null;
  status: string;
  workflowInstanceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toTemplateEntity(row: AppraisalTemplateRow): AppraisalTemplateEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    academicPeriodId: row.academicPeriodId,
    criteria: (Array.isArray(row.criteria) ? row.criteria : []) as AppraisalCriterionEntity[],
    scoreMin: row.scoreMin,
    scoreMax: row.scoreMax,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAppraisalEntity(row: AppraisalRow): AppraisalEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    templateId: row.templateId,
    appraisalDate: row.appraisalDate,
    scores: (Array.isArray(row.scores) ? row.scores : []) as AppraisalScoreEntity[],
    totalScore: row.totalScore,
    overallComment: row.overallComment,
    status: row.status as AppraisalEntity['status'],
    workflowInstanceId: row.workflowInstanceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaAppraisalTemplateRepository implements AppraisalTemplateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<AppraisalTemplateEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AppraisalTemplateEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.staffAppraisalTemplate.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          description: data.description,
          academicPeriodId: data.academicPeriodId,
          criteria: data.criteria as unknown as Prisma.InputJsonValue,
          scoreMin: data.scoreMin,
          scoreMax: data.scoreMax,
        },
      })) as AppraisalTemplateRow;
      return toTemplateEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<AppraisalTemplateEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.staffAppraisalTemplate.findFirst({
        where: { id, tenantId },
      })) as AppraisalTemplateRow | null;
      return row ? toTemplateEntity(row) : null;
    });
  }

  async list(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AppraisalTemplateEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const page = pagination.page;
      const pageSize = pagination.pageSize;
      const where = { tenantId };

      const [totalItems, rows] = await Promise.all([
        tx.staffAppraisalTemplate.count({ where }),
        tx.staffAppraisalTemplate.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }) as Promise<AppraisalTemplateRow[]>,
      ]);

      return {
        data: rows.map(toTemplateEntity),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      };
    });
  }
}

export class PrismaAppraisalRepository implements AppraisalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<AppraisalEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AppraisalEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.staffAppraisal.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          staffId: data.staffId,
          templateId: data.templateId,
          appraisalDate: data.appraisalDate,
          scores: data.scores as unknown as Prisma.InputJsonValue,
          totalScore: data.totalScore,
          overallComment: data.overallComment,
          status: data.status,
          workflowInstanceId: data.workflowInstanceId,
        },
      })) as AppraisalRow;
      return toAppraisalEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<AppraisalEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.staffAppraisal.findFirst({
        where: { id, tenantId },
      })) as AppraisalRow | null;
      return row ? toAppraisalEntity(row) : null;
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<AppraisalEntity>,
  ): Promise<AppraisalEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.staffAppraisal.findFirst({
        where: { id, tenantId },
      })) as AppraisalRow | null;
      if (!existing) return null;

      const current = toAppraisalEntity(existing);
      const merged: AppraisalEntity = { ...current };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (
          key === 'id' ||
          key === 'tenantId' ||
          key === 'createdAt' ||
          key === 'updatedAt'
        ) {
          continue;
        }
        mergedRecord[key] = value;
      }

      const row = (await tx.staffAppraisal.update({
        where: { id },
        data: {
          staffId: merged.staffId,
          templateId: merged.templateId,
          appraisalDate: merged.appraisalDate,
          scores: merged.scores as unknown as Prisma.InputJsonValue,
          totalScore: merged.totalScore,
          overallComment: merged.overallComment,
          status: merged.status,
          workflowInstanceId: merged.workflowInstanceId,
        },
      })) as AppraisalRow;
      return toAppraisalEntity(row);
    });
  }

  async list(
    tenantId: string,
    filter: AppraisalFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AppraisalEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Record<string, unknown> = { tenantId };
      if (filter.staffId) where['staffId'] = filter.staffId;
      if (filter.templateId) where['templateId'] = filter.templateId;
      if (filter.status) where['status'] = filter.status;

      const page = pagination.page;
      const pageSize = pagination.pageSize;

      const [totalItems, rows] = await Promise.all([
        tx.staffAppraisal.count({ where }),
        tx.staffAppraisal.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }) as Promise<AppraisalRow[]>,
      ]);

      return {
        data: rows.map(toAppraisalEntity),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      };
    });
  }
}
