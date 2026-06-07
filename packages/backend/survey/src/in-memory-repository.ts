/**
 * In-memory repository implementations for testing.
 *
 * These implementations store data in memory and are used for unit tests.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type { CompletionStatus } from './schemas.js';
import type {
  SurveyEntity,
  SurveyFilter,
  SurveyRepository,
  DistributionRecordEntity,
  DistributionRepository,
  SubmissionEntity,
  SubmissionRepository,
  InstitutionLookup,
  InstitutionMetadata,
} from './survey-repository.js';

// ─── In-Memory Survey Repository ─────────────────────────────────────────────

export class InMemorySurveyRepository implements SurveyRepository {
  private surveys: SurveyEntity[] = [];

  async create(data: Omit<SurveyEntity, 'createdAt' | 'updatedAt'>): Promise<SurveyEntity> {
    const now = new Date();
    const entity: SurveyEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.surveys.push(entity);
    return entity;
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<Omit<SurveyEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<SurveyEntity | null> {
    const index = this.surveys.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.surveys[index]!;
    const updated: SurveyEntity = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.surveys[index] = updated;
    return updated;
  }

  async findById(id: string, tenantId: string): Promise<SurveyEntity | null> {
    return this.surveys.find((s) => s.id === id && s.tenantId === tenantId) ?? null;
  }

  async findByName(name: string, tenantId: string): Promise<SurveyEntity | null> {
    return this.surveys.find((s) => s.name === name && s.tenantId === tenantId) ?? null;
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const index = this.surveys.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (index === -1) return false;
    this.surveys.splice(index, 1);
    return true;
  }

  async list(
    tenantId: string,
    filter: SurveyFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SurveyEntity>> {
    let filtered = this.surveys.filter((s) => s.tenantId === tenantId);

    if (filter.status) {
      filtered = filtered.filter((s) => s.status === filter.status);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter((s) => s.name.toLowerCase().includes(search));
    }

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
}

// ─── In-Memory Distribution Repository ──────────────────────────────────────

export class InMemoryDistributionRepository implements DistributionRepository {
  private records: DistributionRecordEntity[] = [];

  async createMany(
    records: Omit<DistributionRecordEntity, 'createdAt' | 'updatedAt'>[],
  ): Promise<DistributionRecordEntity[]> {
    const now = new Date();
    const entities = records.map((r) => ({
      ...r,
      createdAt: now,
      updatedAt: now,
    }));
    this.records.push(...entities);
    return entities;
  }

  async findBySurveyAndInstitution(
    tenantId: string,
    surveyId: string,
    institutionId: string,
  ): Promise<DistributionRecordEntity | null> {
    return (
      this.records.find(
        (r) => r.tenantId === tenantId && r.surveyId === surveyId && r.institutionId === institutionId,
      ) ?? null
    );
  }

  async findBySurvey(tenantId: string, surveyId: string): Promise<DistributionRecordEntity[]> {
    return this.records.filter((r) => r.tenantId === tenantId && r.surveyId === surveyId);
  }

  async findIncompleteBySurvey(tenantId: string, surveyId: string): Promise<DistributionRecordEntity[]> {
    return this.records.filter(
      (r) => r.tenantId === tenantId && r.surveyId === surveyId && r.status !== 'completed',
    );
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<Pick<DistributionRecordEntity, 'status' | 'submittedAt' | 'remindersSent'>>,
  ): Promise<DistributionRecordEntity | null> {
    const index = this.records.findIndex((r) => r.id === id && r.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.records[index]!;
    const updated: DistributionRecordEntity = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.records[index] = updated;
    return updated;
  }

  async countByStatus(
    tenantId: string,
    surveyId: string,
  ): Promise<Record<CompletionStatus, number>> {
    const records = this.records.filter(
      (r) => r.tenantId === tenantId && r.surveyId === surveyId,
    );
    return {
      pending: records.filter((r) => r.status === 'pending').length,
      in_progress: records.filter((r) => r.status === 'in_progress').length,
      completed: records.filter((r) => r.status === 'completed').length,
    };
  }
}

// ─── In-Memory Submission Repository ─────────────────────────────────────────

export class InMemorySubmissionRepository implements SubmissionRepository {
  private submissions: SubmissionEntity[] = [];

  async create(data: Omit<SubmissionEntity, 'createdAt'>): Promise<SubmissionEntity> {
    const entity: SubmissionEntity = {
      ...data,
      createdAt: new Date(),
    };
    this.submissions.push(entity);
    return entity;
  }

  async findBySurvey(tenantId: string, surveyId: string): Promise<SubmissionEntity[]> {
    return this.submissions.filter(
      (s) => s.tenantId === tenantId && s.surveyId === surveyId,
    );
  }

  async findBySurveyAndInstitution(
    tenantId: string,
    surveyId: string,
    institutionId: string,
  ): Promise<SubmissionEntity | null> {
    return (
      this.submissions.find(
        (s) => s.tenantId === tenantId && s.surveyId === surveyId && s.institutionId === institutionId,
      ) ?? null
    );
  }
}

// ─── In-Memory Institution Lookup ────────────────────────────────────────────

export class InMemoryInstitutionLookup implements InstitutionLookup {
  private institutions: Array<{
    id: string;
    tenantId: string;
    areaId: string;
    areaName: string;
    typeId: string;
    typeName: string;
    classificationId: string;
    name: string;
  }> = [];

  /** Add an institution for testing */
  addInstitution(institution: {
    id: string;
    tenantId: string;
    areaId: string;
    areaName: string;
    typeId: string;
    typeName: string;
    classificationId: string;
    name: string;
  }): void {
    this.institutions.push(institution);
  }

  async findByFilters(
    tenantId: string,
    filters: {
      areaIds?: string[];
      institutionTypeIds?: string[];
      classificationIds?: string[];
    },
  ): Promise<string[]> {
    let filtered = this.institutions.filter((i) => i.tenantId === tenantId);

    if (filters.areaIds && filters.areaIds.length > 0) {
      filtered = filtered.filter((i) => filters.areaIds!.includes(i.areaId));
    }
    if (filters.institutionTypeIds && filters.institutionTypeIds.length > 0) {
      filtered = filtered.filter((i) => filters.institutionTypeIds!.includes(i.typeId));
    }
    if (filters.classificationIds && filters.classificationIds.length > 0) {
      filtered = filtered.filter((i) => filters.classificationIds!.includes(i.classificationId));
    }

    return filtered.map((i) => i.id);
  }

  async getMetadata(tenantId: string, institutionIds: string[]): Promise<InstitutionMetadata[]> {
    return this.institutions
      .filter((i) => i.tenantId === tenantId && institutionIds.includes(i.id))
      .map((i) => ({
        id: i.id,
        name: i.name,
        areaId: i.areaId,
        areaName: i.areaName,
        typeId: i.typeId,
        typeName: i.typeName,
      }));
  }
}
