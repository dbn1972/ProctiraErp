/**
 * In-Memory Training Repository
 *
 * Used for unit testing without database dependencies.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  TrainingProgramEntity,
  TrainingSessionEntity,
  TrainingAttendanceEntity,
  CertificationEntity,
  CertificationFilter,
  TrainingProgramRepository,
  TrainingSessionRepository,
  TrainingAttendanceRepository,
  CertificationRepository,
} from './training-repository.js';

export class InMemoryTrainingProgramRepository implements TrainingProgramRepository {
  private programs: Map<string, TrainingProgramEntity> = new Map();

  async create(
    data: Omit<TrainingProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TrainingProgramEntity> {
    const now = new Date();
    const entity: TrainingProgramEntity = { ...data, createdAt: now, updatedAt: now };
    this.programs.set(entity.id, entity);
    return entity;
  }

  async findById(id: string, tenantId: string): Promise<TrainingProgramEntity | null> {
    const entity = this.programs.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<TrainingProgramEntity>,
  ): Promise<TrainingProgramEntity | null> {
    const existing = this.programs.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;

    const updated: TrainingProgramEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.programs.set(id, updated);
    return updated;
  }

  async list(
    tenantId: string,
    search: string | undefined,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TrainingProgramEntity>> {
    let items = Array.from(this.programs.values()).filter((e) => e.tenantId === tenantId);

    if (search) {
      const searchLower = search.toLowerCase();
      items = items.filter((e) => e.name.toLowerCase().includes(searchLower));
    }

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  clear(): void {
    this.programs.clear();
  }
}

export class InMemoryTrainingSessionRepository implements TrainingSessionRepository {
  private sessions: Map<string, TrainingSessionEntity> = new Map();

  async create(
    data: Omit<TrainingSessionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<TrainingSessionEntity> {
    const now = new Date();
    const entity: TrainingSessionEntity = { ...data, createdAt: now, updatedAt: now };
    this.sessions.set(entity.id, entity);
    return entity;
  }

  async findById(id: string, tenantId: string): Promise<TrainingSessionEntity | null> {
    const entity = this.sessions.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async listByProgram(
    tenantId: string,
    programId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TrainingSessionEntity>> {
    const items = Array.from(this.sessions.values()).filter(
      (e) => e.tenantId === tenantId && e.programId === programId,
    );

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  clear(): void {
    this.sessions.clear();
  }
}

export class InMemoryTrainingAttendanceRepository implements TrainingAttendanceRepository {
  private records: Map<string, TrainingAttendanceEntity> = new Map();

  async create(
    data: Omit<TrainingAttendanceEntity, 'createdAt'>,
  ): Promise<TrainingAttendanceEntity> {
    const entity: TrainingAttendanceEntity = { ...data, createdAt: new Date() };
    this.records.set(entity.id, entity);
    return entity;
  }

  async findBySessionAndStaff(
    sessionId: string,
    staffId: string,
    tenantId: string,
  ): Promise<TrainingAttendanceEntity | null> {
    for (const entity of this.records.values()) {
      if (
        entity.sessionId === sessionId &&
        entity.staffId === staffId &&
        entity.tenantId === tenantId
      ) {
        return entity;
      }
    }
    return null;
  }

  async listBySession(tenantId: string, sessionId: string): Promise<TrainingAttendanceEntity[]> {
    return Array.from(this.records.values()).filter(
      (e) => e.tenantId === tenantId && e.sessionId === sessionId,
    );
  }

  async listByStaff(tenantId: string, staffId: string): Promise<TrainingAttendanceEntity[]> {
    return Array.from(this.records.values()).filter(
      (e) => e.tenantId === tenantId && e.staffId === staffId,
    );
  }

  clear(): void {
    this.records.clear();
  }
}

export class InMemoryCertificationRepository implements CertificationRepository {
  private certifications: Map<string, CertificationEntity> = new Map();

  async create(
    data: Omit<CertificationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CertificationEntity> {
    const now = new Date();
    const entity: CertificationEntity = { ...data, createdAt: now, updatedAt: now };
    this.certifications.set(entity.id, entity);
    return entity;
  }

  async findById(id: string, tenantId: string): Promise<CertificationEntity | null> {
    const entity = this.certifications.get(id);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<CertificationEntity>,
  ): Promise<CertificationEntity | null> {
    const existing = this.certifications.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;

    const updated: CertificationEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.certifications.set(id, updated);
    return updated;
  }

  async list(
    tenantId: string,
    filter: CertificationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CertificationEntity>> {
    let items = Array.from(this.certifications.values()).filter((e) => e.tenantId === tenantId);

    if (filter.staffId) {
      items = items.filter((e) => e.staffId === filter.staffId);
    }
    if (filter.status) {
      items = items.filter((e) => e.status === filter.status);
    }
    if (filter.programId) {
      items = items.filter((e) => e.programId === filter.programId);
    }

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  async findExpiredCertifications(
    tenantId: string,
    asOfDate: string,
  ): Promise<CertificationEntity[]> {
    return Array.from(this.certifications.values()).filter(
      (e) =>
        e.tenantId === tenantId &&
        e.status === 'ACTIVE' &&
        e.expiryDate !== null &&
        e.expiryDate <= asOfDate,
    );
  }

  clear(): void {
    this.certifications.clear();
  }
}
