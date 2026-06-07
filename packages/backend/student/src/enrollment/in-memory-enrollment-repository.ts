/**
 * In-Memory Enrollment Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the EnrollmentRepository interface with Map-based stores.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  EnrollmentEntity,
  EnrollmentFilter,
  EnrollmentHistoryEntity,
  EnrollmentRepository,
  InstitutionLookup,
  TransferRecordEntity,
} from './enrollment-repository.js';

export class InMemoryEnrollmentRepository implements EnrollmentRepository {
  private enrollments: Map<string, EnrollmentEntity> = new Map();
  private historyEntries: EnrollmentHistoryEntity[] = [];
  private transferRecords: TransferRecordEntity[] = [];
  private institutions: Map<string, InstitutionLookup & { tenantId: string }> = new Map();

  async createEnrollment(
    data: Omit<EnrollmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<EnrollmentEntity> {
    const now = new Date();
    const entity: EnrollmentEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.enrollments.set(entity.id, entity);
    return entity;
  }

  async updateEnrollment(
    id: string,
    tenantId: string,
    data: Partial<EnrollmentEntity>,
  ): Promise<EnrollmentEntity | null> {
    const existing = this.enrollments.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }

    const updated: EnrollmentEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.enrollments.set(id, updated);
    return updated;
  }

  async findEnrollmentById(id: string, tenantId: string): Promise<EnrollmentEntity | null> {
    const entity = this.enrollments.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async listEnrollments(
    tenantId: string,
    filter: EnrollmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<EnrollmentEntity>> {
    let items = Array.from(this.enrollments.values()).filter(
      (entity) => entity.tenantId === tenantId,
    );

    // Apply filters
    if (filter.studentId) {
      items = items.filter((e) => e.studentId === filter.studentId);
    }
    if (filter.institutionId) {
      items = items.filter((e) => e.institutionId === filter.institutionId);
    }
    if (filter.academicPeriodId) {
      items = items.filter((e) => e.academicPeriodId === filter.academicPeriodId);
    }
    if (filter.status) {
      items = items.filter((e) => e.status === filter.status);
    }

    // Sort by enrolledAt descending (most recent first)
    items.sort((a, b) => b.enrolledAt.getTime() - a.enrolledAt.getTime());

    // Paginate
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize) || 0;
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

  async createHistoryEntry(
    data: Omit<EnrollmentHistoryEntity, 'createdAt'>,
  ): Promise<EnrollmentHistoryEntity> {
    const entry: EnrollmentHistoryEntity = {
      ...data,
      createdAt: new Date(),
    };
    this.historyEntries.push(entry);
    return entry;
  }

  async getEnrollmentHistory(
    tenantId: string,
    studentId: string,
  ): Promise<EnrollmentHistoryEntity[]> {
    // Get all enrollment IDs for this student in this tenant
    const enrollmentIds = Array.from(this.enrollments.values())
      .filter((e) => e.tenantId === tenantId && e.studentId === studentId)
      .map((e) => e.id);

    // Return in reverse insertion order (most recent first)
    return this.historyEntries
      .filter((h) => enrollmentIds.includes(h.enrollmentId))
      .reverse();
  }

  async getHistoryByEnrollmentId(enrollmentId: string): Promise<EnrollmentHistoryEntity[]> {
    // Return in reverse insertion order (most recent first)
    return this.historyEntries
      .filter((h) => h.enrollmentId === enrollmentId)
      .reverse();
  }

  async createTransferRecord(
    data: Omit<TransferRecordEntity, 'createdAt'>,
  ): Promise<TransferRecordEntity> {
    const record: TransferRecordEntity = {
      ...data,
      createdAt: new Date(),
    };
    this.transferRecords.push(record);
    return record;
  }

  async getTransferRecords(
    tenantId: string,
    studentId: string,
  ): Promise<TransferRecordEntity[]> {
    return this.transferRecords
      .filter((r) => r.tenantId === tenantId && r.studentId === studentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findInstitutionById(
    id: string,
    tenantId: string,
  ): Promise<InstitutionLookup | null> {
    const inst = this.institutions.get(id);
    if (!inst || inst.tenantId !== tenantId) {
      return null;
    }
    return { id: inst.id, status: inst.status };
  }

  // ---- Test helpers ----

  /** Add an institution to the in-memory store for transfer validation */
  addInstitution(id: string, tenantId: string, status: string): void {
    this.institutions.set(id, { id, tenantId, status });
  }

  /** Clear all data */
  clear(): void {
    this.enrollments.clear();
    this.historyEntries = [];
    this.transferRecords = [];
    this.institutions.clear();
  }
}
