/**
 * Cached Student Repository Decorator
 *
 * Wraps any StudentRepository implementation with a Redis-backed cache layer.
 * Uses read-through caching for findById and invalidates on mutations.
 * If no CacheClient is provided, all operations pass through to the delegate.
 */
import type { CacheClient } from '@proctira/cache';
import { tenantKey } from '@proctira/cache';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type { StudentEntity, StudentFilter, StudentRepository } from './student-repository.js';

/** TTL for student entity cache (5 minutes) */
const STUDENT_TTL_SECONDS = 300;

/**
 * Redis round-trips entities through JSON, so `Date` fields come back as ISO
 * strings. Callers (e.g. `formatStudentResponse`) call `.toISOString()` on
 * them, so a cache hit must restore the same shape the delegate returns.
 */
function reviveDates(entity: StudentEntity | null): StudentEntity | null {
  if (!entity) return entity;
  const createdAt = entity.createdAt as unknown;
  const updatedAt = entity.updatedAt as unknown;
  if (createdAt instanceof Date && updatedAt instanceof Date) return entity;
  return {
    ...entity,
    createdAt: createdAt instanceof Date ? createdAt : new Date(String(createdAt)),
    updatedAt: updatedAt instanceof Date ? updatedAt : new Date(String(updatedAt)),
  };
}

export class CachedStudentRepository implements StudentRepository {
  constructor(
    private readonly delegate: StudentRepository,
    private readonly cache?: CacheClient,
  ) {}

  async create(data: Omit<StudentEntity, 'createdAt' | 'updatedAt'>): Promise<StudentEntity> {
    return this.delegate.create(data);
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<StudentEntity>,
  ): Promise<StudentEntity | null> {
    const result = await this.delegate.update(id, tenantId, data);
    if (result && this.cache) {
      // Invalidate cached entry on update
      const key = tenantKey(tenantId, 'student', id);
      await this.cache.del(key);
    }
    return result;
  }

  async findById(id: string, tenantId: string): Promise<StudentEntity | null> {
    if (!this.cache) {
      return this.delegate.findById(id, tenantId);
    }

    const key = tenantKey(tenantId, 'student', id);
    const cached = await this.cache.getOrSet(
      key,
      () => this.delegate.findById(id, tenantId),
      STUDENT_TTL_SECONDS,
    );
    return reviveDates(cached);
  }

  async findByNationalId(nationalId: string, tenantId: string): Promise<StudentEntity | null> {
    // National ID lookups are not cached (used for uniqueness checks during writes)
    return this.delegate.findByNationalId(nationalId, tenantId);
  }

  async list(
    tenantId: string,
    filter: StudentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentEntity>> {
    return this.delegate.list(tenantId, filter, pagination);
  }

  async search(
    tenantId: string,
    query: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentEntity>> {
    return this.delegate.search(tenantId, query, pagination);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await this.delegate.delete(id, tenantId);
    if (result && this.cache) {
      // Invalidate cached entry on delete
      const key = tenantKey(tenantId, 'student', id);
      await this.cache.del(key);
    }
    return result;
  }
}
