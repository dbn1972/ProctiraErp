/**
 * Cached Examination Repository Decorator
 *
 * Wraps any ExaminationRepository implementation with a Redis-backed cache layer.
 * Uses read-through caching for findById queries.
 * Invalidates on create, update, and delete operations.
 * If no CacheClient is provided, all operations pass through to the delegate.
 */
import type { CacheClient } from '@proctira/cache';
import { tenantKey, reviveDates } from '@proctira/cache';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  ExaminationEntity,
  ExaminationFilter,
  ExaminationRepository,
  CandidateRegistration,
  StudentEnrollment,
} from './examination-repository.js';

/** TTL for examination entity cache (5 minutes) */
const EXAMINATION_TTL_SECONDS = 300;

export class CachedExaminationRepository implements ExaminationRepository {
  constructor(
    private readonly delegate: ExaminationRepository,
    private readonly cache?: CacheClient,
  ) {}

  async create(
    data: Omit<ExaminationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ExaminationEntity> {
    return this.delegate.create(data);
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<ExaminationEntity>,
  ): Promise<ExaminationEntity | null> {
    const result = await this.delegate.update(id, tenantId, data);
    if (result && this.cache) {
      const key = tenantKey(tenantId, 'examination', id);
      await this.cache.del(key);
    }
    return result;
  }

  async findById(id: string, tenantId: string): Promise<ExaminationEntity | null> {
    if (!this.cache) {
      return this.delegate.findById(id, tenantId);
    }

    const key = tenantKey(tenantId, 'examination', id);
    const cached = await this.cache.getOrSet(
      key,
      () => this.delegate.findById(id, tenantId),
      EXAMINATION_TTL_SECONDS,
    );
    return reviveDates(cached);
  }

  async findByCode(code: string, tenantId: string): Promise<ExaminationEntity | null> {
    // Code lookups are not cached (used for uniqueness checks during writes)
    return this.delegate.findByCode(code, tenantId);
  }

  async list(
    tenantId: string,
    filter: ExaminationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ExaminationEntity>> {
    return this.delegate.list(tenantId, filter, pagination);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const result = await this.delegate.delete(id, tenantId);
    if (result && this.cache) {
      const key = tenantKey(tenantId, 'examination', id);
      await this.cache.del(key);
    }
    return result;
  }

  async getStudentEnrollment(
    studentId: string,
    tenantId: string,
  ): Promise<StudentEnrollment | null> {
    return this.delegate.getStudentEnrollment(studentId, tenantId);
  }

  async createCandidateRegistration(data: CandidateRegistration): Promise<CandidateRegistration> {
    return this.delegate.createCandidateRegistration(data);
  }

  async findCandidateRegistration(
    examinationId: string,
    studentId: string,
    tenantId: string,
  ): Promise<CandidateRegistration | null> {
    return this.delegate.findCandidateRegistration(examinationId, studentId, tenantId);
  }

  async listCandidateRegistrations(
    examinationId: string,
    tenantId: string,
  ): Promise<CandidateRegistration[]> {
    return this.delegate.listCandidateRegistrations(examinationId, tenantId);
  }
}
