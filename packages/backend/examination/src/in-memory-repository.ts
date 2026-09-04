/**
 * In-Memory Examination Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the ExaminationRepository interface with a simple Map-based store.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  CandidateRegistration,
  ExaminationEntity,
  ExaminationFilter,
  ExaminationRepository,
  StudentEnrollment,
} from './examination-repository.js';

export class InMemoryExaminationRepository implements ExaminationRepository {
  private examinations: Map<string, ExaminationEntity> = new Map();
  private candidateRegistrations: Map<string, CandidateRegistration> = new Map();
  private studentEnrollments: Map<string, StudentEnrollment> = new Map();

  async create(
    data: Omit<ExaminationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ExaminationEntity> {
    const now = new Date();
    const entity: ExaminationEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.examinations.set(entity.id, entity);
    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<ExaminationEntity>,
  ): Promise<ExaminationEntity | null> {
    const existing = this.examinations.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }

    const updated: ExaminationEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.examinations.set(id, updated);
    return updated;
  }

  async findById(id: string, tenantId: string): Promise<ExaminationEntity | null> {
    const entity = this.examinations.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async findByCode(code: string, tenantId: string): Promise<ExaminationEntity | null> {
    for (const entity of this.examinations.values()) {
      if (entity.code === code && entity.tenantId === tenantId) {
        return entity;
      }
    }
    return null;
  }

  async list(
    tenantId: string,
    filter: ExaminationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ExaminationEntity>> {
    let items = Array.from(this.examinations.values()).filter(
      (entity) => entity.tenantId === tenantId,
    );

    // Apply filters
    if (filter.academicPeriodId) {
      items = items.filter((entity) => entity.academicPeriodId === filter.academicPeriodId);
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
      const aVal = String(a[sortBy as keyof ExaminationEntity] ?? '');
      const bVal = String(b[sortBy as keyof ExaminationEntity] ?? '');
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
    const existing = this.examinations.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return false;
    }
    this.examinations.delete(id);
    return true;
  }

  async getStudentEnrollment(studentId: string, _tenantId: string): Promise<StudentEnrollment | null> {
    return this.studentEnrollments.get(studentId) ?? null;
  }

  async createCandidateRegistration(data: CandidateRegistration): Promise<CandidateRegistration> {
    const key = `${data.examinationId}:${data.studentId}`;
    this.candidateRegistrations.set(key, data);
    return data;
  }

  async findCandidateRegistration(
    examinationId: string,
    studentId: string,
    _tenantId: string,
  ): Promise<CandidateRegistration | null> {
    const key = `${examinationId}:${studentId}`;
    return this.candidateRegistrations.get(key) ?? null;
  }

  async listCandidateRegistrations(
    examinationId: string,
    tenantId: string,
  ): Promise<CandidateRegistration[]> {
    return [...this.candidateRegistrations.values()].filter(
      (r) => r.examinationId === examinationId && r.tenantId === tenantId,
    );
  }

  /** Test helper to set student enrollment data */
  setStudentEnrollment(enrollment: StudentEnrollment): void {
    this.studentEnrollments.set(enrollment.studentId, enrollment);
  }

  /** Test helper to clear all data */
  clear(): void {
    this.examinations.clear();
    this.candidateRegistrations.clear();
    this.studentEnrollments.clear();
  }
}
