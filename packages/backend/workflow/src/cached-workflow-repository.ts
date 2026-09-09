/**
 * Cached Workflow Repository Decorator
 *
 * Wraps any WorkflowRepository implementation with a Redis-backed cache layer.
 * Uses read-through caching for findDefinitionById (definitions rarely change).
 * Invalidates on definition update and delete operations.
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
    return this.delegate.createDefinition(entity);
  }

  async findDefinitionById(id: string, tenantId: string): Promise<WorkflowDefinitionEntity | null> {
    if (!this.cache) {
      return this.delegate.findDefinitionById(id, tenantId);
    }

    const key = tenantKey(tenantId, 'workflow-definition', id);
    const cached = await this.cache.getOrSet(
      key,
      () => this.delegate.findDefinitionById(id, tenantId),
      DEFINITION_TTL_SECONDS,
    );
    return reviveDates(cached);
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
  ): Promise<WorkflowInstanceEntity | null> {
    return this.delegate.updateInstance(id, tenantId, data);
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
