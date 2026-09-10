/**
 * Prisma Assessment Repositories
 *
 * Production implementations of {@link GradingSchemeRepository},
 * {@link AssessmentItemRepository} and {@link OutcomeRepository} backed by
 * PostgreSQL via Prisma, RLS-safe through {@link withTenantTransaction}
 * (tenantId also kept in every `where` clause as defense-in-depth).
 *
 * JSONB round-trips: `thresholds` (GradeThreshold[]) and `outcomeIds`
 * (string[]) are stored as JSONB columns and cast back on read.
 *
 * Ids are supplied by the service layer (uuidv4) — the columns have no
 * database default — so they are passed through verbatim.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  GradingSchemeEntity,
  GradingSchemeFilter,
  GradingSchemeRepository,
  AssessmentItemEntity,
  AssessmentItemRepository,
  OutcomeEntity,
  OutcomeRepository,
} from './assessment-repository.js';
import type { GradingSchemeType, GradeThreshold } from './schemas.js';

// ─── Row shapes (as returned by the Prisma client) ───────────────────────────

interface GradingSchemeRow {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  minValue: number;
  maxValue: number;
  thresholds: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface AssessmentItemRow {
  id: string;
  tenantId: string;
  subjectId: string;
  academicPeriodId: string;
  gradingSchemeId: string;
  name: string;
  weight: number;
  maxScore: number;
  minScore: number;
  outcomeIds: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface OutcomeRow {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  subjectId: string;
  createdAt: Date;
  updatedAt: Date;
}

function toSchemeEntity(row: GradingSchemeRow): GradingSchemeEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    type: row.type as GradingSchemeType,
    minValue: row.minValue,
    maxValue: row.maxValue,
    thresholds: (Array.isArray(row.thresholds) ? row.thresholds : []) as GradeThreshold[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toItemEntity(row: AssessmentItemRow): AssessmentItemEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    subjectId: row.subjectId,
    academicPeriodId: row.academicPeriodId,
    gradingSchemeId: row.gradingSchemeId,
    name: row.name,
    weight: row.weight,
    maxScore: row.maxScore,
    minScore: row.minScore,
    outcomeIds: (Array.isArray(row.outcomeIds) ? row.outcomeIds : []) as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOutcomeEntity(row: OutcomeRow): OutcomeEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    code: row.code,
    description: row.description,
    subjectId: row.subjectId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Grading Scheme Repository ───────────────────────────────────────────────

export class PrismaGradingSchemeRepository implements GradingSchemeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<GradingSchemeEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<GradingSchemeEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.gradingScheme.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          type: data.type,
          minValue: data.minValue,
          maxValue: data.maxValue,
          thresholds: data.thresholds as unknown as Prisma.InputJsonValue,
        },
      })) as GradingSchemeRow;
      return toSchemeEntity(row);
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<GradingSchemeEntity>,
  ): Promise<GradingSchemeEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.gradingScheme.findFirst({
        where: { id, tenantId },
      })) as GradingSchemeRow | null;
      if (!existing) return null;

      const row = (await tx.gradingScheme.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.minValue !== undefined && { minValue: data.minValue }),
          ...(data.maxValue !== undefined && { maxValue: data.maxValue }),
          ...(data.thresholds !== undefined && {
            thresholds: data.thresholds as unknown as Prisma.InputJsonValue,
          }),
        },
      })) as GradingSchemeRow;
      return toSchemeEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<GradingSchemeEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.gradingScheme.findFirst({
        where: { id, tenantId },
      })) as GradingSchemeRow | null;
      return row ? toSchemeEntity(row) : null;
    });
  }

  async findByName(name: string, tenantId: string): Promise<GradingSchemeEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.gradingScheme.findFirst({
        where: {
          tenantId,
          name: { equals: name, mode: 'insensitive' },
        },
      })) as GradingSchemeRow | null;
      return row ? toSchemeEntity(row) : null;
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.gradingScheme.deleteMany({
        where: { id, tenantId },
      });
      return result.count > 0;
    });
  }

  async list(
    tenantId: string,
    filter: GradingSchemeFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<GradingSchemeEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Record<string, unknown> = { tenantId };
      if (filter.type) where['type'] = filter.type;
      if (filter.search) {
        where['name'] = { contains: filter.search, mode: 'insensitive' };
      }

      // Fetch all matching rows and sort in memory with localeCompare so the
      // ordering matches the in-memory repository exactly (DB collation can
      // differ from JS locale ordering).
      const rows = (await tx.gradingScheme.findMany({ where })) as GradingSchemeRow[];
      const entities = rows.map(toSchemeEntity);

      const sortBy = pagination.sortBy ?? 'name';
      const sortOrder = pagination.sortOrder ?? 'asc';
      entities.sort((a, b) => {
        const aVal = String((a as unknown as Record<string, unknown>)[sortBy] ?? '');
        const bVal = String((b as unknown as Record<string, unknown>)[sortBy] ?? '');
        const cmp = aVal.localeCompare(bVal);
        return sortOrder === 'asc' ? cmp : -cmp;
      });

      const totalItems = entities.length;
      const totalPages = Math.ceil(totalItems / pagination.pageSize);
      const start = (pagination.page - 1) * pagination.pageSize;
      const data = entities.slice(start, start + pagination.pageSize);

      return {
        data,
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

// ─── Assessment Item Repository ──────────────────────────────────────────────

export class PrismaAssessmentItemRepository implements AssessmentItemRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async replaceItemsForSubjectPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
    items: Omit<AssessmentItemEntity, 'createdAt' | 'updatedAt'>[],
  ): Promise<AssessmentItemEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      await tx.assessmentItem.deleteMany({
        where: { tenantId, subjectId, academicPeriodId },
      });

      const created: AssessmentItemEntity[] = [];
      // Create sequentially so insertion order (and createdAt ordering) is
      // preserved and the returned array matches the input order.
      for (const item of items) {
        const row = (await tx.assessmentItem.create({
          data: {
            id: item.id,
            tenantId: item.tenantId,
            subjectId: item.subjectId,
            academicPeriodId: item.academicPeriodId,
            gradingSchemeId: item.gradingSchemeId,
            name: item.name,
            weight: item.weight,
            maxScore: item.maxScore,
            minScore: item.minScore,
            outcomeIds: item.outcomeIds as unknown as Prisma.InputJsonValue,
          },
        })) as AssessmentItemRow;
        created.push(toItemEntity(row));
      }
      return created;
    });
  }

  async findBySubjectAndPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<AssessmentItemEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.assessmentItem.findMany({
        where: { tenantId, subjectId, academicPeriodId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })) as AssessmentItemRow[];
      return rows.map(toItemEntity);
    });
  }

  async countBySubjectAndPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<number> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      return tx.assessmentItem.count({
        where: { tenantId, subjectId, academicPeriodId },
      });
    });
  }

  async findById(id: string, tenantId: string): Promise<AssessmentItemEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.assessmentItem.findFirst({
        where: { id, tenantId },
      })) as AssessmentItemRow | null;
      return row ? toItemEntity(row) : null;
    });
  }
}

// ─── Outcome Repository ──────────────────────────────────────────────────────

export class PrismaOutcomeRepository implements OutcomeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: Omit<OutcomeEntity, 'createdAt' | 'updatedAt'>): Promise<OutcomeEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.assessmentOutcome.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          code: data.code,
          description: data.description,
          subjectId: data.subjectId,
        },
      })) as OutcomeRow;
      return toOutcomeEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<OutcomeEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.assessmentOutcome.findFirst({
        where: { id, tenantId },
      })) as OutcomeRow | null;
      return row ? toOutcomeEntity(row) : null;
    });
  }

  async findByIds(ids: string[], tenantId: string): Promise<OutcomeEntity[]> {
    if (ids.length === 0) return [];
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.assessmentOutcome.findMany({
        where: { id: { in: ids }, tenantId },
      })) as OutcomeRow[];
      return rows.map(toOutcomeEntity);
    });
  }

  async findBySubject(tenantId: string, subjectId: string): Promise<OutcomeEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.assessmentOutcome.findMany({
        where: { tenantId, subjectId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })) as OutcomeRow[];
      return rows.map(toOutcomeEntity);
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.assessmentOutcome.deleteMany({
        where: { id, tenantId },
      });
      return result.count > 0;
    });
  }
}
