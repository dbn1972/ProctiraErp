/**
 * Prisma Case Repository
 *
 * Production implementation of {@link CaseRepository} backed by PostgreSQL via
 * Prisma. Tenant-scoped reads/writes run inside {@link withTenantTransaction}
 * so the `app.current_tenant_id` RLS variable is bound on the same connection
 * that executes the query; `tenantId` is also kept in every `where` clause as
 * defense-in-depth.
 *
 * Schema mapping: `attachments`, `resolution`, and `metadata` are JSONB.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { Prisma, withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type {
  CaseAttachmentInput,
  CaseResolutionInput,
  CaseStatus,
  CaseType,
} from './case-schemas.js';
import type {
  CaseEntity,
  CaseFilter,
  CaseRepository,
} from './case-repository.js';

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toMetadata(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function toResolution(value: unknown): CaseResolutionInput | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as CaseResolutionInput;
  }
  return null;
}

function pageArgs(pagination: PaginationOptions): {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, pagination.page);
  const pageSize = Math.max(1, pagination.pageSize);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

interface CaseRow {
  id: string;
  tenantId: string;
  type: string;
  title: string;
  description: string;
  status: string;
  entityType: string;
  entityId: string;
  institutionId: string | null;
  areaId: string | null;
  assignedTo: string | null;
  priority: string | null;
  workflowInstanceId: string | null;
  attachments: unknown;
  resolution: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function toEntity(row: CaseRow): CaseEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type as CaseType,
    title: row.title,
    description: row.description,
    status: row.status as CaseStatus,
    entityType: row.entityType,
    entityId: row.entityId,
    institutionId: row.institutionId,
    areaId: row.areaId,
    assignedTo: row.assignedTo,
    priority: row.priority as CaseEntity['priority'],
    workflowInstanceId: row.workflowInstanceId,
    attachments: jsonArray<CaseAttachmentInput>(row.attachments),
    resolution: toResolution(row.resolution),
    metadata: toMetadata(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaCaseRepository implements CaseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createCase(
    entity: Omit<CaseEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CaseEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.case.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          type: entity.type,
          title: entity.title,
          description: entity.description,
          status: entity.status,
          entityType: entity.entityType,
          entityId: entity.entityId,
          institutionId: entity.institutionId,
          areaId: entity.areaId,
          assignedTo: entity.assignedTo,
          priority: entity.priority,
          workflowInstanceId: entity.workflowInstanceId,
          attachments: entity.attachments as unknown as Prisma.InputJsonValue,
          resolution:
            entity.resolution === null || entity.resolution === undefined
              ? Prisma.JsonNull
              : (entity.resolution as unknown as Prisma.InputJsonValue),
          metadata:
            entity.metadata === null || entity.metadata === undefined
              ? Prisma.JsonNull
              : (entity.metadata as unknown as Prisma.InputJsonValue),
        },
      })) as CaseRow;
      return toEntity(row);
    });
  }

  async findCaseById(id: string, tenantId: string): Promise<CaseEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.case.findFirst({
        where: { id, tenantId },
      })) as CaseRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async updateCase(
    id: string,
    tenantId: string,
    data: Partial<CaseEntity>,
  ): Promise<CaseEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.case.findFirst({
        where: { id, tenantId },
      })) as CaseRow | null;
      if (!existing) return null;

      const updateData: Prisma.CaseUpdateInput = {};
      if (data.type !== undefined) updateData.type = data.type;
      if (data.title !== undefined) updateData.title = data.title;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.status !== undefined) updateData.status = data.status;
      if (data.entityType !== undefined) updateData.entityType = data.entityType;
      if (data.entityId !== undefined) updateData.entityId = data.entityId;
      if (data.institutionId !== undefined) updateData.institutionId = data.institutionId;
      if (data.areaId !== undefined) updateData.areaId = data.areaId;
      if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;
      if (data.priority !== undefined) updateData.priority = data.priority;
      if (data.workflowInstanceId !== undefined) {
        updateData.workflowInstanceId = data.workflowInstanceId;
      }
      if (data.attachments !== undefined) {
        updateData.attachments = data.attachments as unknown as Prisma.InputJsonValue;
      }
      if (data.resolution !== undefined) {
        updateData.resolution =
          data.resolution === null
            ? Prisma.JsonNull
            : (data.resolution as unknown as Prisma.InputJsonValue);
      }
      if (data.metadata !== undefined) {
        updateData.metadata =
          data.metadata === null
            ? Prisma.JsonNull
            : (data.metadata as unknown as Prisma.InputJsonValue);
      }

      const row = (await tx.case.update({
        where: { id },
        data: updateData,
      })) as CaseRow;
      return toEntity(row);
    });
  }

  async listCases(
    tenantId: string,
    filter: CaseFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CaseEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.CaseWhereInput = { tenantId };
      if (filter.type) where.type = filter.type;
      if (filter.status) where.status = filter.status;
      if (filter.entityType) where.entityType = filter.entityType;
      if (filter.entityId) where.entityId = filter.entityId;
      if (filter.assignedTo) where.assignedTo = filter.assignedTo;
      if (filter.institutionId) where.institutionId = filter.institutionId;
      if (filter.areaId) where.areaId = filter.areaId;

      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.case.count({ where }),
        tx.case.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }) as Promise<CaseRow[]>,
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
}
