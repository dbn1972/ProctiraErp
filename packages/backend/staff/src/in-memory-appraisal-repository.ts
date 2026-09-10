/**
 * In-Memory Appraisal Repository
 *
 * Used for unit testing without database dependencies.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  AppraisalTemplateEntity,
  AppraisalEntity,
  AppraisalFilter,
  AppraisalTemplateRepository,
  AppraisalRepository,
} from './appraisal-repository.js';

export class InMemoryAppraisalTemplateRepository implements AppraisalTemplateRepository {
  private templates: Map<string, AppraisalTemplateEntity> = new Map();

  async create(
    data: Omit<AppraisalTemplateEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AppraisalTemplateEntity> {
    const now = new Date();
    const entity: AppraisalTemplateEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.templates.set(entity.id, entity);
    return entity;
  }

  async findById(id: string, tenantId: string): Promise<AppraisalTemplateEntity | null> {
    const entity = this.templates.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async list(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AppraisalTemplateEntity>> {
    const items = Array.from(this.templates.values()).filter((e) => e.tenantId === tenantId);

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
    this.templates.clear();
  }
}

export class InMemoryAppraisalRepository implements AppraisalRepository {
  private appraisals: Map<string, AppraisalEntity> = new Map();

  async create(data: Omit<AppraisalEntity, 'createdAt' | 'updatedAt'>): Promise<AppraisalEntity> {
    const now = new Date();
    const entity: AppraisalEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.appraisals.set(entity.id, entity);
    return entity;
  }

  async findById(id: string, tenantId: string): Promise<AppraisalEntity | null> {
    const entity = this.appraisals.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<AppraisalEntity>,
  ): Promise<AppraisalEntity | null> {
    const existing = this.appraisals.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }

    const updated: AppraisalEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.appraisals.set(id, updated);
    return updated;
  }

  async list(
    tenantId: string,
    filter: AppraisalFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AppraisalEntity>> {
    let items = Array.from(this.appraisals.values()).filter((e) => e.tenantId === tenantId);

    if (filter.staffId) {
      items = items.filter((e) => e.staffId === filter.staffId);
    }
    if (filter.templateId) {
      items = items.filter((e) => e.templateId === filter.templateId);
    }
    if (filter.status) {
      items = items.filter((e) => e.status === filter.status);
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
    this.appraisals.clear();
  }
}
