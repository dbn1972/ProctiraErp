/**
 * In-Memory Staff Assignment Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the StaffAssignmentRepository interface with a simple Map-based store.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  StaffAssignmentEntity,
  StaffAssignmentFilter,
  StaffAssignmentRepository,
} from './assignment-repository.js';

export class InMemoryAssignmentRepository implements StaffAssignmentRepository {
  private assignments: Map<string, StaffAssignmentEntity> = new Map();

  async create(
    data: Omit<StaffAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StaffAssignmentEntity> {
    const now = new Date();
    const entity: StaffAssignmentEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.assignments.set(entity.id, entity);
    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<StaffAssignmentEntity>,
  ): Promise<StaffAssignmentEntity | null> {
    const existing = this.assignments.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }

    const updated: StaffAssignmentEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      staffId: existing.staffId,
      institutionId: existing.institutionId,
      subjectId: existing.subjectId,
      classId: existing.classId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.assignments.set(id, updated);
    return updated;
  }

  async findById(id: string, tenantId: string): Promise<StaffAssignmentEntity | null> {
    const entity = this.assignments.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async findActiveByStaffId(staffId: string, tenantId: string): Promise<StaffAssignmentEntity[]> {
    return Array.from(this.assignments.values()).filter(
      (entity) =>
        entity.tenantId === tenantId && entity.staffId === staffId && entity.status === 'ACTIVE',
    );
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
    return Array.from(this.assignments.values()).filter((entity) => {
      // Must be same tenant, staff, institution, subject, class
      if (entity.tenantId !== tenantId) return false;
      if (entity.staffId !== staffId) return false;
      if (entity.institutionId !== institutionId) return false;
      if (entity.subjectId !== subjectId) return false;
      if (entity.classId !== classId) return false;
      if (entity.status !== 'ACTIVE') return false;
      if (excludeId && entity.id === excludeId) return false;

      // Check date overlap using the rule:
      // Two ranges [s1, e1] and [s2, e2] overlap if s1 < e2 AND s2 < e1
      // When end is null, treat as +infinity
      return this.datesOverlap(entity.startDate, entity.endDate, startDate, endDate);
    });
  }

  /**
   * Check if two date ranges overlap.
   * A null end date means the range extends indefinitely.
   */
  private datesOverlap(
    start1: string,
    end1: string | null,
    start2: string,
    end2: string | null,
  ): boolean {
    // Range 1 starts before range 2 ends (or range 2 has no end)
    const start1BeforeEnd2 = end2 === null || start1 < end2;
    // Range 2 starts before range 1 ends (or range 1 has no end)
    const start2BeforeEnd1 = end1 === null || start2 < end1;

    return start1BeforeEnd2 && start2BeforeEnd1;
  }

  async list(
    tenantId: string,
    filter: StaffAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StaffAssignmentEntity>> {
    let items = Array.from(this.assignments.values()).filter(
      (entity) => entity.tenantId === tenantId,
    );

    // Apply filters
    if (filter.staffId) {
      items = items.filter((entity) => entity.staffId === filter.staffId);
    }
    if (filter.institutionId) {
      items = items.filter((entity) => entity.institutionId === filter.institutionId);
    }
    if (filter.subjectId) {
      items = items.filter((entity) => entity.subjectId === filter.subjectId);
    }
    if (filter.classId) {
      items = items.filter((entity) => entity.classId === filter.classId);
    }
    if (filter.status) {
      items = items.filter((entity) => entity.status === filter.status);
    }

    // Sort by startDate descending (most recent first)
    items.sort((a, b) => b.startDate.localeCompare(a.startDate));

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

  async delete(id: string, tenantId: string): Promise<boolean> {
    const entity = this.assignments.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return false;
    }
    this.assignments.delete(id);
    return true;
  }

  // Test helper
  clear(): void {
    this.assignments.clear();
  }
}
