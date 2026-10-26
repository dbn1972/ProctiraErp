/**
 * Cached Workflow Repository Decorator
 *
 * Wraps any WorkflowRepository implementation with a Redis-backed cache layer.
 * Uses read-through caching for findDefinitionById (definitions rarely change).
 * Invalidates on definition create, update and delete operations; "not found" is never cached.
 * If no CacheClient is provided, all operations pass through to the delegate.
 */
import type { CacheClient } from '@proctira/cache';
import { tenantKey, reviveDates } from '@proctira/cache';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  WorkflowRepository,
  WorkflowDefinitionEntity,
  WorkflowDefinitionFilter,
  WorkflowInstanceEntity,
  WorkflowInstanceFilter,
  TransitionAuditEntity,
  InstanceUpdateGuard,
} from './workflow-repository.js';

/** TTL for workflow definition cache (10 minutes — definitions rarely change) */
const DEFINITION_TTL_SECONDS = 600;

export class CachedWorkflowRepository implements WorkflowRepository {
  constructor(
    private readonly delegate: WorkflowRepository,
    private readonly cache?: CacheClient,
  ) {}

  // ─── Workflow Definition operations ────────────────────────────────────────

  async createDefinition(
    entity: Omit<WorkflowDefinitionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowDefinitionEntity> {
    const created = await this.delegate.createDefinition(entity);
    // PRC-L598: drop any stale entry for this id so the next read sees the new row.
    if (this.cache) {
      await this.cache.del(tenantKey(created.tenantId, 'workflow-definition', created.id));
    }
    return created;
  }

  async findDefinitionById(id: string, tenantId: string): Promise<WorkflowDefinitionEntity | null> {
    if (!this.cache) {
      return this.delegate.findDefinitionById(id, tenantId);
    }

    const key = tenantKey(tenantId, 'workflow-definition', id);
    const cached = await this.cache.get<WorkflowDefinitionEntity>(key);
    if (cached) {
      return reviveDates(cached);
    }
    const fresh = await this.delegate.findDefinitionById(id, tenantId);
    // PRC-L598: never cache "not found"; only real definitions are stored.
    if (fresh) {
      await this.cache.set(key, fresh, DEFINITION_TTL_SECONDS);
    }
    return fresh;
  }

  async updateDefinition(
    id: string,
    tenantId: string,
    data: Partial<WorkflowDefinitionEntity>,
  ): Promise<WorkflowDefinitionEntity | null> {
    const result = await this.delegate.updateDefinition(id, tenantId, data);
    if (result && this.cache) {
      const key = tenantKey(tenantId, 'workflow-definition', id);
      await this.cache.del(key);
    }
    return result;
  }

  async deleteDefinition(id: string, tenantId: string): Promise<boolean> {
    const result = await this.delegate.deleteDefinition(id, tenantId);
    if (result && this.cache) {
      const key = tenantKey(tenantId, 'workflow-definition', id);
      await this.cache.del(key);
    }
    return result;
  }

  async listDefinitions(
    tenantId: string,
    filter: WorkflowDefinitionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<WorkflowDefinitionEntity>> {
    return this.delegate.listDefinitions(tenantId, filter, pagination);
  }

  // ─── Workflow Instance operations ──────────────────────────────────────────

  async createInstance(
    entity: Omit<WorkflowInstanceEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowInstanceEntity> {
    return this.delegate.createInstance(entity);
  }

  async findInstanceById(id: string, tenantId: string): Promise<WorkflowInstanceEntity | null> {
    return this.delegate.findInstanceById(id, tenantId);
  }

  async updateInstance(
    id: string,
    tenantId: string,
    data: Partial<WorkflowInstanceEntity>,
    expected?: InstanceUpdateGuard,
  ): Promise<WorkflowInstanceEntity | null> {
    return this.delegate.updateInstance(id, tenantId, data, expected);
  }

  async listInstances(
    tenantId: string,
    filter: WorkflowInstanceFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<WorkflowInstanceEntity>> {
    return this.delegate.listInstances(tenantId, filter, pagination);
  }

  // ─── Transition Audit operations ──────────────────────────────────────────

  async createAuditRecord(entity: TransitionAuditEntity): Promise<TransitionAuditEntity> {
    return this.delegate.createAuditRecord(entity);
  }

  async getAuditHistory(instanceId: string, tenantId: string): Promise<TransitionAuditEntity[]> {
    return this.delegate.getAuditHistory(instanceId, tenantId);
  }
}
