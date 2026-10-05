/**
 * In-Memory Student Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the StudentRepository interface with a simple Map-based store.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { ConflictError, NotFoundError } from '@proctira/common';

import { ADMISSION_NUMBER_CONFLICT, admissionNoOf } from './admission-number.js';
import type {
  StudentBulkWrite,
  StudentBulkWriteResult,
  StudentEntity,
  StudentFilter,
  StudentRepository,
  StudentUpdateOptions,
} from './student-repository.js';
import { StaleStudentUpdateError, updatedAtMatches } from './student-repository.js';

export class InMemoryStudentRepository implements StudentRepository {
  private students: Map<string, StudentEntity> = new Map();
  private admissionCounters: Map<string, number> = new Map();

  /** Mirrors students_tenant_admission_number_uidx (db/sql/063). */
  private assertAdmissionNoUnique(
    tenantId: string,
    id: string,
    customData?: Record<string, unknown>,
  ): void {
    const no = admissionNoOf(customData);
    if (!no) return;
    for (const s of this.students.values()) {
      if (s.tenantId === tenantId && s.id !== id && admissionNoOf(s.customData) === no) {
        throw new ConflictError(ADMISSION_NUMBER_CONFLICT);
      }
    }
  }

  async create(data: Omit<StudentEntity, 'createdAt' | 'updatedAt'>): Promise<StudentEntity> {
    this.assertAdmissionNoUnique(data.tenantId, data.id, data.customData);
    const now = new Date();
    const entity: StudentEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.students.set(entity.id, entity);
    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<StudentEntity>,
    options?: StudentUpdateOptions,
  ): Promise<StudentEntity | null> {
    const existing = this.students.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }
    // PRC-L365: conditional write (single-threaded map ⇒ check+set is atomic).
    if (
      options?.expectedUpdatedAt &&
      !updatedAtMatches(existing.updatedAt, options.expectedUpdatedAt)
    ) {
      throw new StaleStudentUpdateError(id);
    }

    if (data.customData !== undefined) {
      this.assertAdmissionNoUnique(existing.tenantId, existing.id, data.customData);
    }
    const updated: StudentEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.students.set(id, updated);
    return updated;
  }

  /** PRC-M384: all-or-nothing — restores the pre-batch state on any failure. */
  async bulkWrite(tenantId: string, ops: StudentBulkWrite): Promise<StudentBulkWriteResult> {
    const snapshot = new Map(this.students);
    try {
      const created: StudentEntity[] = [];
      const updated: StudentEntity[] = [];
      for (const data of ops.creates) {
        if (data.tenantId !== tenantId) throw new Error('bulkWrite tenant mismatch');
        created.push(await this.create(data));
      }
      for (const { id, data } of ops.updates) {
        const row = await this.update(id, tenantId, data);
        if (!row) throw new NotFoundError(`Student with id '${id}' not found`);
        updated.push(row);
      }
      return { created, updated };
    } catch (error) {
      this.students = snapshot;
      throw error;
    }
  }

  async findById(id: string, tenantId: string): Promise<StudentEntity | null> {
    const entity = this.students.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async findByNationalId(nationalId: string, tenantId: string): Promise<StudentEntity | null> {
    for (const entity of this.students.values()) {
      if (entity.nationalId === nationalId && entity.tenantId === tenantId) {
        return entity;
      }
    }
    return null;
  }

  async list(
    tenantId: string,
    filter: StudentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentEntity>> {
    let items = Array.from(this.students.values()).filter((entity) => entity.tenantId === tenantId);

    // Apply filters
    if (filter.gender) {
      items = items.filter((entity) => entity.gender === filter.gender);
    }
    if (filter.ids) {
      const wanted = new Set(filter.ids);
      items = items.filter((entity) => wanted.has(entity.id));
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      items = items.filter(
        (entity) =>
          entity.firstName.toLowerCase().includes(searchLower) ||
          entity.lastName.toLowerCase().includes(searchLower) ||
          (entity.nationalId && entity.nationalId.toLowerCase().includes(searchLower)),
      );
    }
    if (filter.institutionId) {
      const institutionId = filter.institutionId;
      items = items.filter((entity) => {
        const custom = entity.customData as Record<string, unknown> | null;
        return custom?.['institutionId'] === institutionId;
      });
    }

    // Sort
    const sortBy = pagination.sortBy ?? 'lastName';
    const sortOrder = pagination.sortOrder ?? 'asc';
    items.sort((a, b) => {
      const aVal = String(a[sortBy as keyof StudentEntity] ?? '');
      const bVal = String(b[sortBy as keyof StudentEntity] ?? '');
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

  async search(
    tenantId: string,
    query: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentEntity>> {
    const queryLower = query.toLowerCase();
    let items = Array.from(this.students.values()).filter((entity) => entity.tenantId === tenantId);

    // Full-text search simulation: match on firstName, lastName, or nationalId
    items = items.filter((entity) => {
      const fullName = `${entity.firstName} ${entity.lastName}`.toLowerCase();
      const nationalId = (entity.nationalId ?? '').toLowerCase();
      return fullName.includes(queryLower) || nationalId.includes(queryLower);
    });

    // Sort by relevance (simple: exact match first, then alphabetical)
    items.sort((a, b) => {
      const aName = `${a.lastName} ${a.firstName}`;
      const bName = `${b.lastName} ${b.firstName}`;
      return aName.localeCompare(bName);
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
    const entity = this.students.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return false;
    }
    this.students.delete(id);
    return true;
  }

  async allocateAdmissionNumber(tenantId: string): Promise<string> {
    const next = (this.admissionCounters.get(tenantId) ?? 0) + 1;
    this.admissionCounters.set(tenantId, next);
    const year = new Date().getUTCFullYear();
    return `ADM-${year}-${String(next).padStart(4, '0')}`;
  }

  // Test helpers
  clear(): void {
    this.students.clear();
    this.admissionCounters.clear();
  }

  getAll(): StudentEntity[] {
    return Array.from(this.students.values());
  }
}
