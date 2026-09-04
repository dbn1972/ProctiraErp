/**
 * Prisma Infrastructure Stores
 *
 * Production implementations of {@link InfrastructureStore} and
 * {@link ConditionOptionStore} backed by PostgreSQL via Prisma. Every method
 * runs inside {@link withTenantTransaction} so the `app.current_tenant_id` RLS
 * variable is bound on the same connection that executes the query; `tenantId`
 * is also kept in every `where` clause as defense-in-depth.
 *
 * Soft-deletes infrastructure items (`deletedAt`); condition options are hard-deleted.
 *
 * @module infrastructure/prisma-store
 */
import { withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type { InfrastructureTypeValue } from './schemas.js';
import type {
  ConditionOptionRecord,
  ConditionOptionStore,
  InfrastructureRecord,
  InfrastructureRepairLogRecord,
  InfrastructureStore,
} from './service.js';

interface InfrastructureRow {
  id: string;
  tenantId: string;
  institutionId: string;
  parentId: string | null;
  name: string;
  type: string;
  capacity: number;
  condition: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface ConditionOptionRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
}

interface RepairLogRow {
  id: string;
  tenantId: string;
  institutionId: string;
  infrastructureItemId: string;
  repairDate: Date;
  notes: string;
  conditionAfter: string;
  cost: { toNumber(): number } | number | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: InfrastructureRow): InfrastructureRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    type: row.type as InfrastructureTypeValue,
    institutionId: row.institutionId,
    parentId: row.parentId,
    capacity: row.capacity,
    condition: row.condition,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toConditionRecord(row: ConditionOptionRow): ConditionOptionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
  };
}

function toCostNumber(cost: RepairLogRow['cost']): number | null {
  if (cost === null || cost === undefined) return null;
  if (typeof cost === 'number') return cost;
  return cost.toNumber();
}

function toRepairRecord(row: RepairLogRow): InfrastructureRepairLogRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    infrastructureItemId: row.infrastructureItemId,
    repairDate: row.repairDate,
    notes: row.notes,
    conditionAfter: row.conditionAfter,
    cost: toCostNumber(row.cost),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const SORTABLE = new Set(['name', 'capacity', 'createdAt']);

function orderBy(
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): Record<string, 'asc' | 'desc'> {
  const field = SORTABLE.has(sortBy) ? sortBy : 'name';
  return { [field]: sortOrder };
}

/**
 * Prisma-backed infrastructure item store.
 */
export class PrismaInfrastructureStore implements InfrastructureStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(record: InfrastructureRecord): Promise<InfrastructureRecord> {
    return withTenantTransaction(this.prisma, record.tenantId, async (tx) => {
      const row = (await tx.infrastructureItem.create({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          institutionId: record.institutionId,
          parentId: record.parentId,
          name: record.name,
          type: record.type,
          capacity: record.capacity,
          condition: record.condition,
          description: record.description,
        },
      })) as InfrastructureRow;
      return toRecord(row);
    });
  }

  async findById(tenantId: string, id: string): Promise<InfrastructureRecord | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.infrastructureItem.findFirst({
        where: { id, tenantId, deletedAt: null },
      })) as InfrastructureRow | null;
      return row ? toRecord(row) : null;
    });
  }

  async findByInstitutionAndType(
    tenantId: string,
    institutionId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, institutionId, type, deletedAt: null };
      const [total, rows] = await Promise.all([
        tx.infrastructureItem.count({ where }),
        tx.infrastructureItem.findMany({
          where,
          orderBy: orderBy(options.sortBy, options.sortOrder),
          skip: (options.page - 1) * options.pageSize,
          take: options.pageSize,
        }),
      ]);
      return { items: (rows as InfrastructureRow[]).map(toRecord), total };
    });
  }

  async findByParent(
    tenantId: string,
    parentId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ): Promise<{ items: InfrastructureRecord[]; total: number }> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = { tenantId, parentId, type, deletedAt: null };
      const [total, rows] = await Promise.all([
        tx.infrastructureItem.count({ where }),
        tx.infrastructureItem.findMany({
          where,
          orderBy: orderBy(options.sortBy, options.sortOrder),
          skip: (options.page - 1) * options.pageSize,
          take: options.pageSize,
        }),
      ]);
      return { items: (rows as InfrastructureRow[]).map(toRecord), total };
    });
  }

  async findAllByInstitution(
    tenantId: string,
    institutionId: string,
  ): Promise<InfrastructureRecord[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.infrastructureItem.findMany({
        where: { tenantId, institutionId, deletedAt: null },
        orderBy: { name: 'asc' },
      })) as InfrastructureRow[];
      return rows.map(toRecord);
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: Partial<
      Pick<InfrastructureRecord, 'name' | 'capacity' | 'condition' | 'description' | 'updatedAt'>
    >,
  ): Promise<InfrastructureRecord | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.infrastructureItem.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) return null;

      const row = (await tx.infrastructureItem.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.capacity !== undefined && { capacity: data.capacity }),
          ...(data.condition !== undefined && { condition: data.condition }),
          ...(data.description !== undefined && { description: data.description }),
        },
      })) as InfrastructureRow;
      return toRecord(row);
    });
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.infrastructureItem.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return result.count > 0;
    });
  }

  async hasChildren(tenantId: string, id: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const count = await tx.infrastructureItem.count({
        where: { tenantId, parentId: id, deletedAt: null },
      });
      return count > 0;
    });
  }

  async createRepairLog(
    record: InfrastructureRepairLogRecord,
  ): Promise<InfrastructureRepairLogRecord> {
    return withTenantTransaction(this.prisma, record.tenantId, async (tx) => {
      const row = (await tx.infrastructureRepairLog.create({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          institutionId: record.institutionId,
          infrastructureItemId: record.infrastructureItemId,
          repairDate: record.repairDate,
          notes: record.notes,
          conditionAfter: record.conditionAfter,
          cost: record.cost,
        },
      })) as RepairLogRow;
      return toRepairRecord(row);
    });
  }

  async listRepairLogs(
    tenantId: string,
    infrastructureItemId: string,
  ): Promise<InfrastructureRepairLogRecord[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.infrastructureRepairLog.findMany({
        where: { tenantId, infrastructureItemId },
        orderBy: { repairDate: 'desc' },
      })) as RepairLogRow[];
      return rows.map(toRepairRecord);
    });
  }
}

/**
 * Prisma-backed condition option store.
 */
export class PrismaConditionOptionStore implements ConditionOptionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(record: ConditionOptionRecord): Promise<ConditionOptionRecord> {
    return withTenantTransaction(this.prisma, record.tenantId, async (tx) => {
      const row = (await tx.infrastructureConditionOption.create({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          name: record.name,
          description: record.description,
        },
      })) as ConditionOptionRow;
      return toConditionRecord(row);
    });
  }

  async findAll(tenantId: string): Promise<ConditionOptionRecord[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.infrastructureConditionOption.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
      })) as ConditionOptionRow[];
      return rows.map(toConditionRecord);
    });
  }

  async findByName(tenantId: string, name: string): Promise<ConditionOptionRecord | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.infrastructureConditionOption.findFirst({
        where: { tenantId, name },
      })) as ConditionOptionRow | null;
      return row ? toConditionRecord(row) : null;
    });
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.infrastructureConditionOption.deleteMany({
        where: { id, tenantId },
      });
      return result.count > 0;
    });
  }
}
