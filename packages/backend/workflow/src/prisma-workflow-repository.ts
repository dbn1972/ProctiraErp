/**
 * Prisma Workflow Repository
 *
 * Production implementation of {@link WorkflowRepository} backed by PostgreSQL
 * via Prisma. Tenant-scoped reads/writes run inside {@link withTenantTransaction}
 * so the `app.current_tenant_id` RLS variable is bound on the same connection
 * that executes the query; `tenantId` is also kept in every `where` clause as
 * defense-in-depth.
 *
 * Schema mapping:
 *  - `states`, `transitions`, `escalationRules`, `metadata`, and `approvals`
 *    are JSONB columns — cast on write and rehydrated on read.
 *  - Approval `timestamp` values may round-trip as ISO strings through JSONB.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { Prisma, withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type {
  EscalationRuleInput,
  WorkflowStateInput,
  WorkflowTransitionInput,
} from './schemas.js';
import type {
  ApprovalRecord,
  TransitionAuditEntity,
  WorkflowDefinitionEntity,
  WorkflowDefinitionFilter,
  WorkflowInstanceEntity,
  WorkflowInstanceFilter,
  WorkflowInstanceStatus,
  WorkflowRepository,
} from './workflow-repository.js';

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

function toApprovals(value: unknown): ApprovalRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const rec = item as Record<string, unknown>;
    return {
      stateId: String(rec['stateId'] ?? ''),
      actorId: String(rec['actorId'] ?? ''),
      action: String(rec['action'] ?? ''),
      timestamp: toDate(rec['timestamp']),
    };
  });
}

function toMetadata(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
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

interface DefinitionRow {
  id: string;
  tenantId: string;
  name: string;
  entityType: string;
  description: string | null;
  states: unknown;
  transitions: unknown;
  escalationRules: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface InstanceRow {
  id: string;
  tenantId: string;
  workflowDefinitionId: string;
  entityType: string;
  entityId: string;
  currentStateId: string;
  status: string;
  metadata: unknown;
  approvals: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface AuditRow {
  id: string;
  tenantId: string;
  instanceId: string;
  fromStateId: string;
  toStateId: string;
  action: string;
  actorId: string;
  comments: string | null;
  timestamp: Date;
}

function toDefinition(row: DefinitionRow): WorkflowDefinitionEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    entityType: row.entityType,
    description: row.description,
    states: jsonArray<WorkflowStateInput>(row.states),
    transitions: jsonArray<WorkflowTransitionInput>(row.transitions),
    escalationRules:
      row.escalationRules === null || row.escalationRules === undefined
        ? null
        : jsonArray<EscalationRuleInput>(row.escalationRules),
    isActive: row.isActive !== false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toInstance(row: InstanceRow): WorkflowInstanceEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    workflowDefinitionId: row.workflowDefinitionId,
    entityType: row.entityType,
    entityId: row.entityId,
    currentStateId: row.currentStateId,
    status: row.status as WorkflowInstanceStatus,
    metadata: toMetadata(row.metadata),
    approvals: toApprovals(row.approvals),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAudit(row: AuditRow): TransitionAuditEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    instanceId: row.instanceId,
    fromStateId: row.fromStateId,
    toStateId: row.toStateId,
    action: row.action,
    actorId: row.actorId,
    comments: row.comments,
    timestamp: row.timestamp,
  };
}

export class PrismaWorkflowRepository implements WorkflowRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── Definition Operations ───────────────────────────────────────────────

  async createDefinition(
    entity: Omit<WorkflowDefinitionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowDefinitionEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.workflowDefinition.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          name: entity.name,
          entityType: entity.entityType,
          description: entity.description,
          states: entity.states as unknown as Prisma.InputJsonValue,
          transitions: entity.transitions as unknown as Prisma.InputJsonValue,
          escalationRules:
            entity.escalationRules === null || entity.escalationRules === undefined
              ? Prisma.JsonNull
              : (entity.escalationRules as unknown as Prisma.InputJsonValue),
          isActive: entity.isActive,
        },
      })) as DefinitionRow;
      return toDefinition(row);
    });
  }

  async findDefinitionById(
    id: string,
    tenantId: string,
  ): Promise<WorkflowDefinitionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.workflowDefinition.findFirst({
        where: { id, tenantId },
      })) as DefinitionRow | null;
      return row ? toDefinition(row) : null;
    });
  }

  async updateDefinition(
    id: string,
    tenantId: string,
    data: Partial<WorkflowDefinitionEntity>,
  ): Promise<WorkflowDefinitionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.workflowDefinition.findFirst({
        where: { id, tenantId },
      })) as DefinitionRow | null;
      if (!existing) return null;

      const updateData: Prisma.WorkflowDefinitionUpdateInput = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.entityType !== undefined) updateData.entityType = data.entityType;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.states !== undefined) {
        updateData.states = data.states as unknown as Prisma.InputJsonValue;
      }
      if (data.transitions !== undefined) {
        updateData.transitions = data.transitions as unknown as Prisma.InputJsonValue;
      }
      if (data.escalationRules !== undefined) {
        updateData.escalationRules =
          data.escalationRules === null
            ? Prisma.JsonNull
            : (data.escalationRules as unknown as Prisma.InputJsonValue);
      }
      if (data.isActive !== undefined) updateData.isActive = data.isActive;

      const row = (await tx.workflowDefinition.update({
        where: { id },
        data: updateData,
      })) as DefinitionRow;
      return toDefinition(row);
    });
  }

  async deleteDefinition(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.workflowDefinition.deleteMany({
        where: { id, tenantId },
      });
      return result.count > 0;
    });
  }

  async listDefinitions(
    tenantId: string,
    filter: WorkflowDefinitionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<WorkflowDefinitionEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.WorkflowDefinitionWhereInput = { tenantId };
      if (filter.entityType) where.entityType = filter.entityType;

      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.workflowDefinition.count({ where }),
        tx.workflowDefinition.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }) as Promise<DefinitionRow[]>,
      ]);

      return {
        data: rows.map(toDefinition),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      };
    });
  }

  // ─── Instance Operations ─────────────────────────────────────────────────

  async createInstance(
    entity: Omit<WorkflowInstanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowInstanceEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.workflowInstance.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          workflowDefinitionId: entity.workflowDefinitionId,
          entityType: entity.entityType,
          entityId: entity.entityId,
          currentStateId: entity.currentStateId,
          status: entity.status,
          metadata:
            entity.metadata === null || entity.metadata === undefined
              ? Prisma.JsonNull
              : (entity.metadata as unknown as Prisma.InputJsonValue),
          approvals: entity.approvals as unknown as Prisma.InputJsonValue,
        },
      })) as InstanceRow;
      return toInstance(row);
    });
  }

  async findInstanceById(
    id: string,
    tenantId: string,
  ): Promise<WorkflowInstanceEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.workflowInstance.findFirst({
        where: { id, tenantId },
      })) as InstanceRow | null;
      return row ? toInstance(row) : null;
    });
  }

  async updateInstance(
    id: string,
    tenantId: string,
    data: Partial<WorkflowInstanceEntity>,
  ): Promise<WorkflowInstanceEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.workflowInstance.findFirst({
        where: { id, tenantId },
      })) as InstanceRow | null;
      if (!existing) return null;

      const updateData: Prisma.WorkflowInstanceUpdateInput = {};
      if (data.workflowDefinitionId !== undefined) {
        updateData.workflowDefinitionId = data.workflowDefinitionId;
      }
      if (data.entityType !== undefined) updateData.entityType = data.entityType;
      if (data.entityId !== undefined) updateData.entityId = data.entityId;
      if (data.currentStateId !== undefined) {
        updateData.currentStateId = data.currentStateId;
      }
      if (data.status !== undefined) updateData.status = data.status;
      if (data.metadata !== undefined) {
        updateData.metadata =
          data.metadata === null
            ? Prisma.JsonNull
            : (data.metadata as unknown as Prisma.InputJsonValue);
      }
      if (data.approvals !== undefined) {
        updateData.approvals = data.approvals as unknown as Prisma.InputJsonValue;
      }

      const row = (await tx.workflowInstance.update({
        where: { id },
        data: updateData,
      })) as InstanceRow;
      return toInstance(row);
    });
  }

  async listInstances(
    tenantId: string,
    filter: WorkflowInstanceFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<WorkflowInstanceEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.WorkflowInstanceWhereInput = { tenantId };
      if (filter.entityType) where.entityType = filter.entityType;
      if (filter.entityId) where.entityId = filter.entityId;
      if (filter.status) where.status = filter.status;
      if (filter.workflowDefinitionId) {
        where.workflowDefinitionId = filter.workflowDefinitionId;
      }

      const { skip, take, page, pageSize } = pageArgs(pagination);
      const [totalItems, rows] = await Promise.all([
        tx.workflowInstance.count({ where }),
        tx.workflowInstance.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }) as Promise<InstanceRow[]>,
      ]);

      return {
        data: rows.map(toInstance),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / pageSize),
        },
      };
    });
  }

  // ─── Audit Operations ────────────────────────────────────────────────────

  async createAuditRecord(
    entity: TransitionAuditEntity,
  ): Promise<TransitionAuditEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.transitionAudit.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          instanceId: entity.instanceId,
          fromStateId: entity.fromStateId,
          toStateId: entity.toStateId,
          action: entity.action,
          actorId: entity.actorId,
          comments: entity.comments,
          timestamp: entity.timestamp,
        },
      })) as AuditRow;
      return toAudit(row);
    });
  }

  async getAuditHistory(
    instanceId: string,
    tenantId: string,
  ): Promise<TransitionAuditEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.transitionAudit.findMany({
        where: { instanceId, tenantId },
        orderBy: { timestamp: 'asc' },
      })) as AuditRow[];
      return rows.map(toAudit);
    });
  }
}
