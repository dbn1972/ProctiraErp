/**
 * Cached Student Repository Decorator
 *
 * Wraps any StudentRepository implementation with a Redis-backed cache layer.
 * Uses read-through caching for findById and invalidates on mutations.
 * If no CacheClient is provided, all operations pass through to the delegate.
 */
import type { CacheClient } from '@proctira/cache';
import { reviveDates, tenantKey } from '@proctira/cache';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  StudentAuditDirective,
  StudentBulkWrite,
  StudentBulkWriteResult,
  StudentEntity,
  StudentFilter,
  StudentRepository,
  StudentUpdateOptions,
} from './student-repository.js';

/** TTL for student entity cache (5 minutes) */
const STUDENT_TTL_SECONDS = 300;

export class CachedStudentRepository implements StudentRepository {
  constructor(
    private readonly delegate: StudentRepository,
    private readonly cache?: CacheClient,
  ) {
    const bulk = delegate.bulkWrite?.bind(delegate);
    if (bulk) {
      this.bulkWrite = async (tenantId, ops) => {
        const result = await bulk(tenantId, ops);
        if (this.cache) {
          for (const { id } of ops.updates)
            await this.cache.del(tenantKey(tenantId, 'student', id));
        }
        return result;
      };
    }
  }

  /**
   * PRC-M013: transparently inherit the delegate's same-transaction audit
   * capability so wrapping the Pg repository in a cache does not silently drop
   * the atomic audit guarantee.
   */
  get supportsTransactionalAudit(): boolean {
    return Boolean(this.delegate.supportsTransactionalAudit);
  }

  /** PRC-M384: only exposed when the delegate is transactional. */
  readonly bulkWrite?: (tenantId: string, ops: StudentBulkWrite) => Promise<StudentBulkWriteResult>;

  async create(data: Omit<StudentEntity, 'createdAt' | 'updatedAt'>): Promise<StudentEntity> {
    return this.delegate.create(data);
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<StudentEntity>,
    options?: StudentUpdateOptions,
    audit?: StudentAuditDirective,
  ): Promise<StudentEntity | null> {
    const result = await this.delegate.update(id, tenantId, data, options, audit);
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

  async allocateAdmissionNumber(tenantId: string): Promise<string> {
    return this.delegate.allocateAdmissionNumber(tenantId);
  }

  async delete(id: string, tenantId: string, audit?: StudentAuditDirective): Promise<boolean> {
    const result = await this.delegate.delete(id, tenantId, audit);
    if (result && this.cache) {
      // Invalidate cached entry on delete
      const key = tenantKey(tenantId, 'student', id);
      await this.cache.del(key);
    }
    return result;
  }
}
