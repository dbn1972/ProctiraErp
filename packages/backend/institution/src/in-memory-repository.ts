/**
 * In-Memory Institution Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the InstitutionRepository interface with a simple Map-based store.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  InstitutionEntity,
  InstitutionFilter,
  InstitutionRepository,
} from './institution-repository.js';

export class InMemoryInstitutionRepository implements InstitutionRepository {
  private institutions: Map<string, InstitutionEntity> = new Map();
  private enrollmentCounts: Map<string, number> = new Map();
  private staffAssignmentCounts: Map<string, number> = new Map();

  async create(
    data: Omit<InstitutionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<InstitutionEntity> {
    const now = new Date();
    const entity: InstitutionEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.institutions.set(entity.id, entity);
    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<InstitutionEntity>,
  ): Promise<InstitutionEntity | null> {
    const existing = this.institutions.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }

    const updated: InstitutionEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.institutions.set(id, updated);
    return updated;
  }

  async findById(id: string, tenantId: string): Promise<InstitutionEntity | null> {
    const entity = this.institutions.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async findByCode(code: string): Promise<InstitutionEntity | null> {
    for (const entity of this.institutions.values()) {
      if (entity.code === code) {
        return entity;
      }
    }
    return null;
  }

  async findByNameInArea(
    name: string,
    areaId: string,
    tenantId: string,
  ): Promise<InstitutionEntity | null> {
    for (const entity of this.institutions.values()) {
      if (entity.name === name && entity.areaId === areaId && entity.tenantId === tenantId) {
        return entity;
      }
    }
    return null;
  }

  async list(
    tenantId: string,
    filter: InstitutionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionEntity>> {
    let items = Array.from(this.institutions.values()).filter(
      (entity) => entity.tenantId === tenantId,
    );

    // Apply filters
    if (filter.areaId) {
      items = items.filter((entity) => entity.areaId === filter.areaId);
    }
    if (filter.status) {
      items = items.filter((entity) => entity.status === filter.status);
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      items = items.filter(
        (entity) =>
          entity.name.toLowerCase().includes(searchLower) ||
          entity.code.toLowerCase().includes(searchLower),
      );
    }

    // Sort
    const sortBy = pagination.sortBy ?? 'name';
    const sortOrder = pagination.sortOrder ?? 'asc';
    items.sort((a, b) => {
      const aVal = String(a[sortBy as keyof InstitutionEntity] ?? '');
      const bVal = String(b[sortBy as keyof InstitutionEntity] ?? '');
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    // Paginate
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

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

  async countActiveEnrollments(institutionId: string, _tenantId: string): Promise<number> {
    return this.enrollmentCounts.get(institutionId) ?? 0;
  }

  async countActiveStaffAssignments(institutionId: string, _tenantId: string): Promise<number> {
    return this.staffAssignmentCounts.get(institutionId) ?? 0;
  }

  // Test helpers
  setEnrollmentCount(institutionId: string, count: number): void {
    this.enrollmentCounts.set(institutionId, count);
  }

  setStaffAssignmentCount(institutionId: string, count: number): void {
    this.staffAssignmentCounts.set(institutionId, count);
  }

  clear(): void {
    this.institutions.clear();
    this.enrollmentCounts.clear();
    this.staffAssignmentCounts.clear();
  }
}
