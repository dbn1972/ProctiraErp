/**
 * In-Memory Staff Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the StaffRepository interface with a simple Map-based store.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  StaffEntity,
  StaffFilter,
  StaffRepository,
} from './staff-repository.js';

export class InMemoryStaffRepository implements StaffRepository {
  private staff: Map<string, StaffEntity> = new Map();

  async create(
    data: Omit<StaffEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StaffEntity> {
    const now = new Date();
    const entity: StaffEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.staff.set(entity.id, entity);
    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<StaffEntity>,
  ): Promise<StaffEntity | null> {
    const existing = this.staff.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }

    const updated: StaffEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.staff.set(id, updated);
    return updated;
  }

  async findById(id: string, tenantId: string): Promise<StaffEntity | null> {
    const entity = this.staff.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async findByIdentityNumber(identityNumber: string): Promise<StaffEntity | null> {
    for (const entity of this.staff.values()) {
      if (entity.identityNumber === identityNumber) {
        return entity;
      }
    }
    return null;
  }

  async list(
    tenantId: string,
    filter: StaffFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StaffEntity>> {
    let items = Array.from(this.staff.values()).filter(
      (entity) => entity.tenantId === tenantId,
    );

    // Apply filters
    if (filter.status) {
      items = items.filter((entity) => entity.status === filter.status);
    }
    if (filter.position) {
      items = items.filter((entity) => entity.position === filter.position);
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      items = items.filter(
        (entity) =>
          entity.firstName.toLowerCase().includes(searchLower) ||
          entity.lastName.toLowerCase().includes(searchLower) ||
          `${entity.firstName} ${entity.lastName}`.toLowerCase().includes(searchLower) ||
          entity.identityNumber.toLowerCase().includes(searchLower),
      );
    }

    // Sort
    const sortBy = pagination.sortBy ?? 'lastName';
    const sortOrder = pagination.sortOrder ?? 'asc';
    items.sort((a, b) => {
      const aVal = String(a[sortBy as keyof StaffEntity] ?? '');
      const bVal = String(b[sortBy as keyof StaffEntity] ?? '');
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

  async delete(id: string, tenantId: string): Promise<boolean> {
    const entity = this.staff.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return false;
    }
    this.staff.delete(id);
    return true;
  }

  // Test helper
  clear(): void {
    this.staff.clear();
  }
}
