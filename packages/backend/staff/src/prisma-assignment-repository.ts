/**
 * Prisma Staff Assignment Repository
 *
 * Production implementation of {@link StaffAssignmentRepository} backed by
 * PostgreSQL via Prisma (table `staff_assignments`), RLS-safe through
 * {@link withTenantTransaction} (tenantId also kept in every `where` clause
 * as defense-in-depth).
 *
 * Date handling: the entity uses ISO date strings (YYYY-MM-DD) while the DB
 * columns are `@db.Date` → converted both ways at the boundary.
 *
 * findOverlapping: candidate rows are fetched by the five equality keys plus
 * status=ACTIVE, then the exact datesOverlap() rule from the in-memory
 * implementation is applied in TypeScript for exact behavioral parity.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type {
  StaffAssignmentEntity,
  StaffAssignmentFilter,
  StaffAssignmentRepository,
} from './assignment-repository.js';

interface StaffAssignmentRow {
  id: string;
  tenantId: string;
  staffId: string;
  institutionId: string;
  subjectId: string;
  classId: string;
  role: string;
  allocationPercentage: number;
  startDate: Date;
  endDate: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toEntity(row: StaffAssignmentRow): StaffAssignmentEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    institutionId: row.institutionId,
    subjectId: row.subjectId,
    classId: row.classId,
    role: row.role,
    allocationPercentage: row.allocationPercentage,
    startDate: toIsoDate(row.startDate),
    endDate: row.endDate ? toIsoDate(row.endDate) : null,
    status: row.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Check if two date ranges overlap (exact rule from the in-memory repo).
 * A null end date means the range extends indefinitely.
 */
function datesOverlap(
  start1: string,
  end1: string | null,
  start2: string,
  end2: string | null,
): boolean {
  const start1BeforeEnd2 = end2 === null || start1 < end2;
  const start2BeforeEnd1 = end1 === null || start2 < end1;
  return start1BeforeEnd2 && start2BeforeEnd1;
}

export class PrismaAssignmentRepository implements StaffAssignmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<StaffAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StaffAssignmentEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.staffAssignment.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          staffId: data.staffId,
          institutionId: data.institutionId,
          subjectId: data.subjectId,
          classId: data.classId,
          role: data.role,
          allocationPercentage: data.allocationPercentage,
          startDate: new Date(data.startDate),
          endDate: data.endDate ? new Date(data.endDate) : null,
          status: data.status,
        },
      })) as StaffAssignmentRow;
      return toEntity(row);
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<StaffAssignmentEntity>,
  ): Promise<StaffAssignmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.staffAssignment.findFirst({
        where: { id, tenantId },
      })) as StaffAssignmentRow | null;
      if (!existing) return null;

      const current = toEntity(existing);
      const merged: StaffAssignmentEntity = { ...current };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (
          key === 'id' ||
          key === 'tenantId' ||
          key === 'staffId' ||
          key === 'institutionId' ||
          key === 'subjectId' ||
          key === 'classId' ||
          key === 'createdAt' ||
          key === 'updatedAt'
        ) {
          continue;
        }
        mergedRecord[key] = value;
      }

      const row = (await tx.staffAssignment.update({
        where: { id },
        data: {
          role: merged.role,
          allocationPercentage: merged.allocationPercentage,
          startDate: new Date(merged.startDate),
          endDate: merged.endDate ? new Date(merged.endDate) : null,
          status: merged.status,
        },
      })) as StaffAssignmentRow;
      return toEntity(row);
    });
  }

  async findById(
    id: string,
    tenantId: string,
  ): Promise<StaffAssignmentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.staffAssignment.findFirst({
        where: { id, tenantId },
      })) as StaffAssignmentRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async findActiveByStaffId(
    staffId: string,
    tenantId: string,
  ): Promise<StaffAssignmentEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.staffAssignment.findMany({
        where: { tenantId, staffId, status: 'ACTIVE' },
      })) as StaffAssignmentRow[];
      return rows.map(toEntity);
    });
  }

  async findOverlapping(
    tenantId: string,
    staffId: string,
    institutionId: string,
    subjectId: string,
    classId: string,
    startDate: string,
    endDate: string | null,
    excludeId?: string,
  ): Promise<StaffAssignmentEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.staffAssignment.findMany({
        where: {
          tenantId,
          staffId,
          institutionId,
          subjectId,
          classId,
          status: 'ACTIVE',
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      })) as StaffAssignmentRow[];

      return rows
        .map(toEntity)
        .filter((entity) =>
          datesOverlap(entity.startDate, entity.endDate, startDate, endDate),
        );
    });
  }

  async list(
    tenantId: string,
    filter: StaffAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StaffAssignmentEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Record<string, unknown> = { tenantId };
      if (filter.staffId) where['staffId'] = filter.staffId;
      if (filter.institutionId) where['institutionId'] = filter.institutionId;
      if (filter.subjectId) where['subjectId'] = filter.subjectId;
      if (filter.classId) where['classId'] = filter.classId;
      if (filter.status) where['status'] = filter.status;

      const page = pagination.page;
      const pageSize = pagination.pageSize;

      const [totalItems, rows] = await Promise.all([
        tx.staffAssignment.count({ where }),
        tx.staffAssignment.findMany({
          where,
          orderBy: { startDate: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }) as Promise<StaffAssignmentRow[]>,
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
      const result = await tx.staffAssignment.deleteMany({
        where: { id, tenantId },
      });
      return result.count > 0;
    });
  }
}
