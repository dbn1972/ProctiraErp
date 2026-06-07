/**
 * In-Memory Policy Repository
 *
 * Used for testing and development. Stores policies, versions, and assignments
 * in memory with full interface compliance.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type {
  PolicyEntity,
  PolicyVersionEntity,
  PolicyAssignmentEntity,
  PolicyFilter,
  PolicyRepository,
} from './policy-repository.js';
import type { PolicyType } from './schemas.js';

export class InMemoryPolicyRepository implements PolicyRepository {
  private policies: PolicyEntity[] = [];
  private versions: PolicyVersionEntity[] = [];
  private assignments: PolicyAssignmentEntity[] = [];

  // ─── Policy CRUD ─────────────────────────────────────────────────────────

  async create(data: Omit<PolicyEntity, 'createdAt' | 'updatedAt'>): Promise<PolicyEntity> {
    const now = new Date();
    const entity: PolicyEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.policies.push(entity);
    return entity;
  }

  async update(id: string, tenantId: string, data: Partial<PolicyEntity>): Promise<PolicyEntity | null> {
    const index = this.policies.findIndex((p) => p.id === id && p.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.policies[index]!;
    const updated: PolicyEntity = {
      id: existing.id,
      tenantId: existing.tenantId,
      name: data.name ?? existing.name,
      description: data.description !== undefined ? data.description : existing.description,
      type: data.type ?? existing.type,
      scope: data.scope ?? existing.scope,
      status: data.status ?? existing.status,
      rules: data.rules ?? existing.rules,
      version: data.version ?? existing.version,
      effectiveFrom: data.effectiveFrom !== undefined ? data.effectiveFrom : existing.effectiveFrom,
      effectiveUntil: data.effectiveUntil !== undefined ? data.effectiveUntil : existing.effectiveUntil,
      priority: data.priority ?? existing.priority,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.policies[index] = updated;
    return updated;
  }

  async findById(id: string, tenantId: string): Promise<PolicyEntity | null> {
    return this.policies.find((p) => p.id === id && p.tenantId === tenantId) ?? null;
  }

  async findByName(name: string, tenantId: string): Promise<PolicyEntity | null> {
    return this.policies.find(
      (p) => p.name.toLowerCase() === name.toLowerCase() && p.tenantId === tenantId,
    ) ?? null;
  }

  async list(
    tenantId: string,
    filter: PolicyFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<PolicyEntity>> {
    let filtered = this.policies.filter((p) => p.tenantId === tenantId);

    if (filter.type) {
      filtered = filtered.filter((p) => p.type === filter.type);
    }
    if (filter.scope) {
      filtered = filtered.filter((p) => p.scope === filter.scope);
    }
    if (filter.status) {
      filtered = filtered.filter((p) => p.status === filter.status);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          (p.description && p.description.toLowerCase().includes(search)),
      );
    }

    // Sort
    const sortBy = pagination.sortBy ?? 'name';
    const sortOrder = pagination.sortOrder ?? 'asc';
    filtered.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortBy];
      const bVal = (b as unknown as Record<string, unknown>)[sortBy];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const cmp = aVal < bVal ? -1 : 1;
      return sortOrder === 'asc' ? cmp : -cmp;
    });

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

  async delete(id: string, tenantId: string): Promise<boolean> {
    const index = this.policies.findIndex((p) => p.id === id && p.tenantId === tenantId);
    if (index === -1) return false;
    this.policies.splice(index, 1);
    return true;
  }

  // ─── Policy Versions ─────────────────────────────────────────────────────

  async createVersion(data: Omit<PolicyVersionEntity, 'createdAt'>): Promise<PolicyVersionEntity> {
    const entity: PolicyVersionEntity = {
      ...data,
      createdAt: new Date(),
    };
    this.versions.push(entity);
    return entity;
  }

  async getVersions(policyId: string): Promise<PolicyVersionEntity[]> {
    return this.versions
      .filter((v) => v.policyId === policyId)
      .sort((a, b) => b.version - a.version);
  }

  async getVersion(policyId: string, version: number): Promise<PolicyVersionEntity | null> {
    return this.versions.find((v) => v.policyId === policyId && v.version === version) ?? null;
  }

  // ─── Policy Assignments ──────────────────────────────────────────────────

  async createAssignment(data: Omit<PolicyAssignmentEntity, 'createdAt'>): Promise<PolicyAssignmentEntity> {
    const entity: PolicyAssignmentEntity = {
      ...data,
      createdAt: new Date(),
    };
    this.assignments.push(entity);
    return entity;
  }

  async removeAssignment(id: string, tenantId: string): Promise<boolean> {
    const index = this.assignments.findIndex((a) => a.id === id && a.tenantId === tenantId);
    if (index === -1) return false;
    this.assignments.splice(index, 1);
    return true;
  }

  async findAssignmentsByTarget(
    targetType: 'platform' | 'tenant' | 'institution',
    targetId: string | null,
    tenantId: string,
    policyType?: PolicyType,
  ): Promise<PolicyAssignmentEntity[]> {
    let filtered = this.assignments.filter(
      (a) => a.targetType === targetType && a.tenantId === tenantId,
    );

    if (targetId !== null) {
      filtered = filtered.filter((a) => a.targetId === targetId);
    } else {
      filtered = filtered.filter((a) => a.targetId === null);
    }

    if (policyType) {
      const policyIds = this.policies
        .filter((p) => p.type === policyType)
        .map((p) => p.id);
      filtered = filtered.filter((a) => policyIds.includes(a.policyId));
    }

    return filtered;
  }

  async findAssignmentsByPolicy(policyId: string, tenantId: string): Promise<PolicyAssignmentEntity[]> {
    return this.assignments.filter((a) => a.policyId === policyId && a.tenantId === tenantId);
  }

  // ─── Test Helpers ────────────────────────────────────────────────────────

  /** Clear all data (for testing) */
  clear(): void {
    this.policies = [];
    this.versions = [];
    this.assignments = [];
  }
}
