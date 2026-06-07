/**
 * In-Memory Workflow Repository
 *
 * Used for unit testing without database dependencies.
 * Stores workflow definitions, instances, and audit records in memory.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type {
  WorkflowRepository,
  WorkflowDefinitionEntity,
  WorkflowDefinitionFilter,
  WorkflowInstanceEntity,
  WorkflowInstanceFilter,
  TransitionAuditEntity,
} from './workflow-repository.js';

export class InMemoryWorkflowRepository implements WorkflowRepository {
  private definitions: WorkflowDefinitionEntity[] = [];
  private instances: WorkflowInstanceEntity[] = [];
  private auditRecords: TransitionAuditEntity[] = [];

  // ─── Definition Operations ───────────────────────────────────────────────

  async createDefinition(
    entity: Omit<WorkflowDefinitionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowDefinitionEntity> {
    const now = new Date();
    const definition: WorkflowDefinitionEntity = {
      ...entity,
      createdAt: now,
      updatedAt: now,
    };
    this.definitions.push(definition);
    return definition;
  }

  async findDefinitionById(id: string, tenantId: string): Promise<WorkflowDefinitionEntity | null> {
    return this.definitions.find((d) => d.id === id && d.tenantId === tenantId) ?? null;
  }

  async updateDefinition(
    id: string,
    tenantId: string,
    data: Partial<WorkflowDefinitionEntity>,
  ): Promise<WorkflowDefinitionEntity | null> {
    const index = this.definitions.findIndex((d) => d.id === id && d.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.definitions[index]!;
    const updated: WorkflowDefinitionEntity = {
      id: existing.id,
      tenantId: existing.tenantId,
      name: data.name ?? existing.name,
      entityType: data.entityType ?? existing.entityType,
      description: data.description !== undefined ? data.description : existing.description,
      states: data.states ?? existing.states,
      transitions: data.transitions ?? existing.transitions,
      escalationRules: data.escalationRules !== undefined ? data.escalationRules : existing.escalationRules,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.definitions[index] = updated;
    return updated;
  }

  async deleteDefinition(id: string, tenantId: string): Promise<boolean> {
    const index = this.definitions.findIndex((d) => d.id === id && d.tenantId === tenantId);
    if (index === -1) return false;
    this.definitions.splice(index, 1);
    return true;
  }

  async listDefinitions(
    tenantId: string,
    filter: WorkflowDefinitionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<WorkflowDefinitionEntity>> {
    let filtered = this.definitions.filter((d) => d.tenantId === tenantId);

    if (filter.entityType) {
      filtered = filtered.filter((d) => d.entityType === filter.entityType);
    }

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = filtered.slice(start, start + pagination.pageSize);

    return {
      data,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  // ─── Instance Operations ─────────────────────────────────────────────────

  async createInstance(
    entity: Omit<WorkflowInstanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowInstanceEntity> {
    const now = new Date();
    const instance: WorkflowInstanceEntity = {
      ...entity,
      createdAt: now,
      updatedAt: now,
    };
    this.instances.push(instance);
    return instance;
  }

  async findInstanceById(id: string, tenantId: string): Promise<WorkflowInstanceEntity | null> {
    return this.instances.find((i) => i.id === id && i.tenantId === tenantId) ?? null;
  }

  async updateInstance(
    id: string,
    tenantId: string,
    data: Partial<WorkflowInstanceEntity>,
  ): Promise<WorkflowInstanceEntity | null> {
    const index = this.instances.findIndex((i) => i.id === id && i.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.instances[index]!;
    const updated: WorkflowInstanceEntity = {
      id: existing.id,
      tenantId: existing.tenantId,
      workflowDefinitionId: data.workflowDefinitionId ?? existing.workflowDefinitionId,
      entityType: data.entityType ?? existing.entityType,
      entityId: data.entityId ?? existing.entityId,
      currentStateId: data.currentStateId ?? existing.currentStateId,
      status: data.status ?? existing.status,
      metadata: data.metadata !== undefined ? data.metadata : existing.metadata,
      approvals: data.approvals ?? existing.approvals,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.instances[index] = updated;
    return updated;
  }

  async listInstances(
    tenantId: string,
    filter: WorkflowInstanceFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<WorkflowInstanceEntity>> {
    let filtered = this.instances.filter((i) => i.tenantId === tenantId);

    if (filter.entityType) {
      filtered = filtered.filter((i) => i.entityType === filter.entityType);
    }
    if (filter.entityId) {
      filtered = filtered.filter((i) => i.entityId === filter.entityId);
    }
    if (filter.status) {
      filtered = filtered.filter((i) => i.status === filter.status);
    }
    if (filter.workflowDefinitionId) {
      filtered = filtered.filter((i) => i.workflowDefinitionId === filter.workflowDefinitionId);
    }

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = filtered.slice(start, start + pagination.pageSize);

    return {
      data,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  // ─── Audit Operations ────────────────────────────────────────────────────

  async createAuditRecord(entity: TransitionAuditEntity): Promise<TransitionAuditEntity> {
    this.auditRecords.push(entity);
    return entity;
  }

  async getAuditHistory(instanceId: string, tenantId: string): Promise<TransitionAuditEntity[]> {
    return this.auditRecords
      .filter((a) => a.instanceId === instanceId && a.tenantId === tenantId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // ─── Test Helpers ────────────────────────────────────────────────────────

  clear(): void {
    this.definitions = [];
    this.instances = [];
    this.auditRecords = [];
  }
}
