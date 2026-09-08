/**
 * Cached Institution Repository Decorator
 *
 * Wraps any InstitutionRepository implementation with a Redis-backed cache layer.
 * Uses read-through caching for findById and list-by-area queries.
 * Invalidates on create, update, and deactivate operations.
 * If no CacheClient is provided, all operations pass through to the delegate.
 */
import type { CacheClient } from '@proctira/cache';
import { tenantKey, listKey } from '@proctira/cache';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  InstitutionEntity,
  InstitutionFilter,
  InstitutionRepository,
} from './institution-repository.js';

/** TTL for institution entity cache (5 minutes) */
const INSTITUTION_TTL_SECONDS = 300;

export class CachedInstitutionRepository implements InstitutionRepository {
  constructor(
    private readonly delegate: InstitutionRepository,
    private readonly cache?: CacheClient,
  ) {}

  async create(
    data: Omit<InstitutionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<InstitutionEntity> {
    const result = await this.delegate.create(data);
    if (this.cache) {
      // Invalidate area-based list caches for this tenant
      await this.cache.invalidatePattern(`lst:${data.tenantId}:institution:*`);
    }
    return result;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<InstitutionEntity>,
  ): Promise<InstitutionEntity | null> {
    const result = await this.delegate.update(id, tenantId, data);
    if (result && this.cache) {
      // Invalidate the entity cache and area-based list caches
      const key = tenantKey(tenantId, 'institution', id);
      await this.cache.del(key);
      await this.cache.invalidatePattern(`lst:${tenantId}:institution:*`);
    }
    return result;
  }

  async findById(id: string, tenantId: string): Promise<InstitutionEntity | null> {
    if (!this.cache) {
      return this.delegate.findById(id, tenantId);
    }

    const key = tenantKey(tenantId, 'institution', id);
    return this.cache.getOrSet(
      key,
      () => this.delegate.findById(id, tenantId),
      INSTITUTION_TTL_SECONDS,
    );
  }

  async findByCode(code: string): Promise<InstitutionEntity | null> {
    // Code lookups are not cached (used for uniqueness checks during writes)
    return this.delegate.findByCode(code);
  }

  async findByNameInArea(
    name: string,
    areaId: string,
    tenantId: string,
  ): Promise<InstitutionEntity | null> {
    // Name-in-area lookups are not cached (used for uniqueness checks during writes)
    return this.delegate.findByNameInArea(name, areaId, tenantId);
  }

  async list(
    tenantId: string,
    filter: InstitutionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionEntity>> {
    if (!this.cache) {
      return this.delegate.list(tenantId, filter, pagination);
    }

    // Cache area-filtered list queries with a deterministic hash
    const filterHash = JSON.stringify({ ...filter, ...pagination });
    const key = listKey(tenantId, 'institution', filterHash);
    return this.cache.getOrSet(
      key,
      () => this.delegate.list(tenantId, filter, pagination),
      INSTITUTION_TTL_SECONDS,
    );
  }

  async countActiveEnrollments(institutionId: string, tenantId: string): Promise<number> {
    return this.delegate.countActiveEnrollments(institutionId, tenantId);
  }

  async countActiveStaffAssignments(institutionId: string, tenantId: string): Promise<number> {
    return this.delegate.countActiveStaffAssignments(institutionId, tenantId);
  }
}
