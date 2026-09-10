/**
 * In-Memory Case Repository
 *
 * Used for unit testing without database dependencies.
 * Stores case entities in memory.
 *
 * Requirements: 13.5
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type { CaseRepository, CaseEntity, CaseFilter } from './case-repository.js';

export class InMemoryCaseRepository implements CaseRepository {
  private cases: CaseEntity[] = [];

  async createCase(entity: Omit<CaseEntity, 'createdAt' | 'updatedAt'>): Promise<CaseEntity> {
    const now = new Date();
    const caseEntity: CaseEntity = {
      ...entity,
      createdAt: now,
      updatedAt: now,
    };
    this.cases.push(caseEntity);
    return caseEntity;
  }

  async findCaseById(id: string, tenantId: string): Promise<CaseEntity | null> {
    return this.cases.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
  }

  async updateCase(
    id: string,
    tenantId: string,
    data: Partial<CaseEntity>,
  ): Promise<CaseEntity | null> {
    const index = this.cases.findIndex((c) => c.id === id && c.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.cases[index]!;
    const updated: CaseEntity = {
      id: existing.id,
      tenantId: existing.tenantId,
      type: data.type ?? existing.type,
      title: data.title ?? existing.title,
      description: data.description ?? existing.description,
      status: data.status ?? existing.status,
      entityType: data.entityType ?? existing.entityType,
      entityId: data.entityId ?? existing.entityId,
      institutionId: data.institutionId !== undefined ? data.institutionId : existing.institutionId,
      areaId: data.areaId !== undefined ? data.areaId : existing.areaId,
      assignedTo: data.assignedTo !== undefined ? data.assignedTo : existing.assignedTo,
      priority: data.priority !== undefined ? data.priority : existing.priority,
      workflowInstanceId:
        data.workflowInstanceId !== undefined
          ? data.workflowInstanceId
          : existing.workflowInstanceId,
      attachments: data.attachments ?? existing.attachments,
      resolution: data.resolution !== undefined ? data.resolution : existing.resolution,
      metadata: data.metadata !== undefined ? data.metadata : existing.metadata,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.cases[index] = updated;
    return updated;
  }

  async listCases(
    tenantId: string,
    filter: CaseFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CaseEntity>> {
    let filtered = this.cases.filter((c) => c.tenantId === tenantId);

    if (filter.type) {
      filtered = filtered.filter((c) => c.type === filter.type);
    }
    if (filter.status) {
      filtered = filtered.filter((c) => c.status === filter.status);
    }
    if (filter.entityType) {
      filtered = filtered.filter((c) => c.entityType === filter.entityType);
    }
    if (filter.entityId) {
      filtered = filtered.filter((c) => c.entityId === filter.entityId);
    }
    if (filter.assignedTo) {
      filtered = filtered.filter((c) => c.assignedTo === filter.assignedTo);
    }
    if (filter.institutionId) {
      filtered = filtered.filter((c) => c.institutionId === filter.institutionId);
    }
    if (filter.areaId) {
      filtered = filtered.filter((c) => c.areaId === filter.areaId);
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

  // ─── Test Helpers ────────────────────────────────────────────────────────

  clear(): void {
    this.cases = [];
  }
}
