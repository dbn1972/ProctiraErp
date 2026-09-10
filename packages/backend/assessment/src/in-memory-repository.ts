/**
 * In-Memory Repository Implementations
 *
 * Used for unit testing without database dependencies.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type {
  GradingSchemeEntity,
  GradingSchemeFilter,
  GradingSchemeRepository,
  AssessmentItemEntity,
  AssessmentItemRepository,
  OutcomeEntity,
  OutcomeRepository,
} from './assessment-repository.js';

// ─── In-Memory Grading Scheme Repository ─────────────────────────────────────

export class InMemoryGradingSchemeRepository implements GradingSchemeRepository {
  private schemes: GradingSchemeEntity[] = [];

  async create(
    data: Omit<GradingSchemeEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<GradingSchemeEntity> {
    const now = new Date();
    const entity: GradingSchemeEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.schemes.push(entity);
    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<GradingSchemeEntity>,
  ): Promise<GradingSchemeEntity | null> {
    const index = this.schemes.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.schemes[index]!;
    const updated: GradingSchemeEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.schemes[index] = updated;
    return updated;
  }

  async findById(id: string, tenantId: string): Promise<GradingSchemeEntity | null> {
    return this.schemes.find((s) => s.id === id && s.tenantId === tenantId) ?? null;
  }

  async findByName(name: string, tenantId: string): Promise<GradingSchemeEntity | null> {
    return (
      this.schemes.find(
        (s) => s.name.toLowerCase() === name.toLowerCase() && s.tenantId === tenantId,
      ) ?? null
    );
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const index = this.schemes.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (index === -1) return false;
    this.schemes.splice(index, 1);
    return true;
  }

  async list(
    tenantId: string,
    filter: GradingSchemeFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<GradingSchemeEntity>> {
    let filtered = this.schemes.filter((s) => s.tenantId === tenantId);

    if (filter.type) {
      filtered = filtered.filter((s) => s.type === filter.type);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter((s) => s.name.toLowerCase().includes(search));
    }

    // Sort
    const sortBy = pagination.sortBy ?? 'name';
    const sortOrder = pagination.sortOrder ?? 'asc';
    filtered.sort((a, b) => {
      const aVal = String((a as unknown as Record<string, unknown>)[sortBy] ?? '');
      const bVal = String((b as unknown as Record<string, unknown>)[sortBy] ?? '');
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = filtered.slice(start, start + pagination.pageSize);

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

  /** Helper for tests: clear all data */
  clear(): void {
    this.schemes = [];
  }
}

// ─── In-Memory Assessment Item Repository ────────────────────────────────────

export class InMemoryAssessmentItemRepository implements AssessmentItemRepository {
  private items: AssessmentItemEntity[] = [];

  async replaceItemsForSubjectPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
    items: Omit<AssessmentItemEntity, 'createdAt' | 'updatedAt'>[],
  ): Promise<AssessmentItemEntity[]> {
    // Remove existing items for this subject+period
    this.items = this.items.filter(
      (i) =>
        !(
          i.tenantId === tenantId &&
          i.subjectId === subjectId &&
          i.academicPeriodId === academicPeriodId
        ),
    );

    const now = new Date();
    const entities: AssessmentItemEntity[] = items.map((item) => ({
      ...item,
      createdAt: now,
      updatedAt: now,
    }));

    this.items.push(...entities);
    return entities;
  }

  async findBySubjectAndPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<AssessmentItemEntity[]> {
    return this.items.filter(
      (i) =>
        i.tenantId === tenantId &&
        i.subjectId === subjectId &&
        i.academicPeriodId === academicPeriodId,
    );
  }

  async countBySubjectAndPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<number> {
    return this.items.filter(
      (i) =>
        i.tenantId === tenantId &&
        i.subjectId === subjectId &&
        i.academicPeriodId === academicPeriodId,
    ).length;
  }

  async findById(id: string, tenantId: string): Promise<AssessmentItemEntity | null> {
    return this.items.find((i) => i.id === id && i.tenantId === tenantId) ?? null;
  }

  /** Helper for tests: clear all data */
  clear(): void {
    this.items = [];
  }
}

// ─── In-Memory Outcome Repository ───────────────────────────────────────────

export class InMemoryOutcomeRepository implements OutcomeRepository {
  private outcomes: OutcomeEntity[] = [];

  async create(data: Omit<OutcomeEntity, 'createdAt' | 'updatedAt'>): Promise<OutcomeEntity> {
    const now = new Date();
    const entity: OutcomeEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.outcomes.push(entity);
    return entity;
  }

  async findById(id: string, tenantId: string): Promise<OutcomeEntity | null> {
    return this.outcomes.find((o) => o.id === id && o.tenantId === tenantId) ?? null;
  }

  async findByIds(ids: string[], tenantId: string): Promise<OutcomeEntity[]> {
    return this.outcomes.filter((o) => ids.includes(o.id) && o.tenantId === tenantId);
  }

  async findBySubject(tenantId: string, subjectId: string): Promise<OutcomeEntity[]> {
    return this.outcomes.filter((o) => o.tenantId === tenantId && o.subjectId === subjectId);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const index = this.outcomes.findIndex((o) => o.id === id && o.tenantId === tenantId);
    if (index === -1) return false;
    this.outcomes.splice(index, 1);
    return true;
  }

  /** Helper for tests: clear all data */
  clear(): void {
    this.outcomes = [];
  }
}
