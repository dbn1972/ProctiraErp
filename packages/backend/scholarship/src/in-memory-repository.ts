/**
 * In-Memory Scholarship Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the ScholarshipRepository interface with Map-based stores.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  ScholarshipProgramEntity,
  ScholarshipApplicationEntity,
  DisbursementEntity,
  ComplianceRecordEntity,
  ProgramFilter,
  ApplicationFilter,
  DisbursementFilter,
  UtilizationReportFilter,
  UtilizationReportData,
  ScholarshipRepository,
} from './scholarship-repository.js';

export class InMemoryScholarshipRepository implements ScholarshipRepository {
  private programs: Map<string, ScholarshipProgramEntity> = new Map();
  private applications: Map<string, ScholarshipApplicationEntity> = new Map();
  private disbursements: Map<string, DisbursementEntity> = new Map();
  private complianceRecords: Map<string, ComplianceRecordEntity> = new Map();

  // ─── Program Operations ──────────────────────────────────────────────────

  async createProgram(
    data: Omit<ScholarshipProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScholarshipProgramEntity> {
    const now = new Date();
    const entity: ScholarshipProgramEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.programs.set(entity.id, entity);
    return entity;
  }

  async updateProgram(
    id: string,
    tenantId: string,
    data: Partial<ScholarshipProgramEntity>,
  ): Promise<ScholarshipProgramEntity | null> {
    const existing = this.programs.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }
    const updated: ScholarshipProgramEntity = {
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

  async findProgramById(id: string, tenantId: string): Promise<ScholarshipProgramEntity | null> {
    const entity = this.programs.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async listPrograms(
    tenantId: string,
    filter: ProgramFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScholarshipProgramEntity>> {
    let items = Array.from(this.programs.values()).filter(
      (entity) => entity.tenantId === tenantId,
    );

    if (filter.status) {
      items = items.filter((entity) => entity.status === filter.status);
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      items = items.filter((entity) =>
        entity.name.toLowerCase().includes(searchLower),
      );
    }

    // Sort
    const sortBy = pagination.sortBy ?? 'createdAt';
    const sortOrder = pagination.sortOrder ?? 'desc';
    items.sort((a, b) => {
      const aVal = String(a[sortBy as keyof ScholarshipProgramEntity] ?? '');
      const bVal = String(b[sortBy as keyof ScholarshipProgramEntity] ?? '');
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize) || 1;
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages } };
  }

  async deleteProgram(id: string, tenantId: string): Promise<boolean> {
    const existing = this.programs.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return false;
    }
    this.programs.delete(id);
    return true;
  }

  // ─── Application Operations ──────────────────────────────────────────────

  async createApplication(
    data: Omit<ScholarshipApplicationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScholarshipApplicationEntity> {
    const now = new Date();
    const entity: ScholarshipApplicationEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.applications.set(entity.id, entity);
    return entity;
  }

  async updateApplication(
    id: string,
    tenantId: string,
    data: Partial<ScholarshipApplicationEntity>,
  ): Promise<ScholarshipApplicationEntity | null> {
    const existing = this.applications.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }
    const updated: ScholarshipApplicationEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.applications.set(id, updated);
    return updated;
  }

  async findApplicationById(id: string, tenantId: string): Promise<ScholarshipApplicationEntity | null> {
    const entity = this.applications.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async listApplications(
    tenantId: string,
    filter: ApplicationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScholarshipApplicationEntity>> {
    let items = Array.from(this.applications.values()).filter(
      (entity) => entity.tenantId === tenantId,
    );

    if (filter.programId) {
      items = items.filter((e) => e.programId === filter.programId);
    }
    if (filter.applicantId) {
      items = items.filter((e) => e.applicantId === filter.applicantId);
    }
    if (filter.institutionId) {
      items = items.filter((e) => e.institutionId === filter.institutionId);
    }
    if (filter.status) {
      items = items.filter((e) => e.status === filter.status);
    }
    if (filter.areaId) {
      items = items.filter((e) => e.areaId === filter.areaId);
    }
    if (filter.gender) {
      items = items.filter((e) => e.gender === filter.gender);
    }

    const sortBy = pagination.sortBy ?? 'createdAt';
    const sortOrder = pagination.sortOrder ?? 'desc';
    items.sort((a, b) => {
      const aVal = String(a[sortBy as keyof ScholarshipApplicationEntity] ?? '');
      const bVal = String(b[sortBy as keyof ScholarshipApplicationEntity] ?? '');
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize) || 1;
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages } };
  }

  async countApplicationsByProgram(programId: string, tenantId: string): Promise<number> {
    return Array.from(this.applications.values()).filter(
      (e) => e.programId === programId && e.tenantId === tenantId && e.status !== 'withdrawn' && e.status !== 'rejected',
    ).length;
  }

  async findApplicationByApplicantAndProgram(
    applicantId: string,
    programId: string,
    tenantId: string,
  ): Promise<ScholarshipApplicationEntity | null> {
    for (const entity of this.applications.values()) {
      if (
        entity.applicantId === applicantId &&
        entity.programId === programId &&
        entity.tenantId === tenantId &&
        entity.status !== 'withdrawn'
      ) {
        return entity;
      }
    }
    return null;
  }

  // ─── Disbursement Operations ─────────────────────────────────────────────

  async createDisbursement(
    data: Omit<DisbursementEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DisbursementEntity> {
    const now = new Date();
    const entity: DisbursementEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.disbursements.set(entity.id, entity);
    return entity;
  }

  async updateDisbursement(
    id: string,
    tenantId: string,
    data: Partial<DisbursementEntity>,
  ): Promise<DisbursementEntity | null> {
    const existing = this.disbursements.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }
    const updated: DisbursementEntity = {
      ...existing,
      ...data,
      id: existing.id,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };
    this.disbursements.set(id, updated);
    return updated;
  }

  async findDisbursementById(id: string, tenantId: string): Promise<DisbursementEntity | null> {
    const entity = this.disbursements.get(id);
    if (!entity || entity.tenantId !== tenantId) {
      return null;
    }
    return entity;
  }

  async listDisbursements(
    tenantId: string,
    filter: DisbursementFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DisbursementEntity>> {
    let items = Array.from(this.disbursements.values()).filter(
      (entity) => entity.tenantId === tenantId,
    );

    if (filter.applicationId) {
      items = items.filter((e) => e.applicationId === filter.applicationId);
    }
    if (filter.paymentStatus) {
      items = items.filter((e) => e.paymentStatus === filter.paymentStatus);
    }
    if (filter.scheduledDateFrom) {
      items = items.filter((e) => e.scheduledDate >= filter.scheduledDateFrom!);
    }
    if (filter.scheduledDateTo) {
      items = items.filter((e) => e.scheduledDate <= filter.scheduledDateTo!);
    }

    const sortBy = pagination.sortBy ?? 'scheduledDate';
    const sortOrder = pagination.sortOrder ?? 'asc';
    items.sort((a, b) => {
      const aVal = String(a[sortBy as keyof DisbursementEntity] ?? '');
      const bVal = String(b[sortBy as keyof DisbursementEntity] ?? '');
      const cmp = aVal.localeCompare(bVal);
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize) || 1;
    const start = (pagination.page - 1) * pagination.pageSize;
    const data = items.slice(start, start + pagination.pageSize);

    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages } };
  }

  async listDisbursementsByApplication(applicationId: string, tenantId: string): Promise<DisbursementEntity[]> {
    return Array.from(this.disbursements.values()).filter(
      (e) => e.applicationId === applicationId && e.tenantId === tenantId,
    );
  }

  // ─── Compliance Operations ───────────────────────────────────────────────

  async createComplianceRecord(
    data: Omit<ComplianceRecordEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ComplianceRecordEntity> {
    const now = new Date();
    const entity: ComplianceRecordEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.complianceRecords.set(entity.id, entity);
    return entity;
  }

  async listComplianceRecords(applicationId: string, tenantId: string): Promise<ComplianceRecordEntity[]> {
    return Array.from(this.complianceRecords.values()).filter(
      (e) => e.applicationId === applicationId && e.tenantId === tenantId,
    );
  }

  // ─── Report Operations ───────────────────────────────────────────────────

  async getUtilizationReport(tenantId: string, filter: UtilizationReportFilter): Promise<UtilizationReportData> {
    const programs = Array.from(this.programs.values()).filter((p) => p.tenantId === tenantId);
    let apps = Array.from(this.applications.values()).filter((a) => a.tenantId === tenantId);
    const disbursementsList = Array.from(this.disbursements.values()).filter((d) => d.tenantId === tenantId);

    // Apply filters
    if (filter.programId) {
      apps = apps.filter((a) => a.programId === filter.programId);
    }
    if (filter.areaId) {
      apps = apps.filter((a) => a.areaId === filter.areaId);
    }
    if (filter.gender) {
      apps = apps.filter((a) => a.gender === filter.gender);
    }
    if (filter.institutionId) {
      apps = apps.filter((a) => a.institutionId === filter.institutionId);
    }

    const approvedApps = apps.filter((a) => a.status === 'approved');
    const approvedAppIds = new Set(approvedApps.map((a) => a.id));
    const paidDisbursements = disbursementsList.filter(
      (d) => approvedAppIds.has(d.applicationId) && d.paymentStatus === 'paid',
    );

    const totalAmount = paidDisbursements.reduce((sum, d) => sum + d.amount, 0);
    const currency = programs.length > 0 && programs[0] ? programs[0].currency : 'USD';

    // Build breakdown
    const groupBy = filter.groupBy ?? 'program';
    const groupMap = new Map<string, { applicationCount: number; approvedCount: number; disbursedAmount: number }>();

    for (const app of apps) {
      let key: string;
      switch (groupBy) {
        case 'program':
          key = app.programId;
          break;
        case 'area':
          key = app.areaId ?? 'unknown';
          break;
        case 'gender':
          key = app.gender ?? 'unknown';
          break;
        case 'institution':
          key = app.institutionId;
          break;
        default:
          key = app.programId;
      }

      if (!groupMap.has(key)) {
        groupMap.set(key, { applicationCount: 0, approvedCount: 0, disbursedAmount: 0 });
      }
      const group = groupMap.get(key)!;
      group.applicationCount++;
      if (app.status === 'approved') {
        group.approvedCount++;
      }
    }

    // Add disbursement amounts to groups
    for (const d of paidDisbursements) {
      const app = this.applications.get(d.applicationId);
      if (!app) continue;
      let key: string;
      switch (groupBy) {
        case 'program':
          key = app.programId;
          break;
        case 'area':
          key = app.areaId ?? 'unknown';
          break;
        case 'gender':
          key = app.gender ?? 'unknown';
          break;
        case 'institution':
          key = app.institutionId;
          break;
        default:
          key = app.programId;
      }
      const group = groupMap.get(key);
      if (group) {
        group.disbursedAmount += d.amount;
      }
    }

    const breakdown = Array.from(groupMap.entries()).map(([key, data]) => ({
      groupKey: groupBy,
      groupValue: key,
      applicationCount: data.applicationCount,
      approvedCount: data.approvedCount,
      disbursedAmount: data.disbursedAmount,
      utilizationRate: data.applicationCount > 0
        ? Math.round((data.approvedCount / data.applicationCount) * 10000) / 100
        : 0,
    }));

    return {
      totalPrograms: programs.length,
      totalApplications: apps.length,
      totalApproved: approvedApps.length,
      totalDisbursed: paidDisbursements.length,
      totalAmount,
      currency,
      breakdown,
    };
  }

  // ─── Test Helpers ────────────────────────────────────────────────────────

  clear(): void {
    this.programs.clear();
    this.applications.clear();
    this.disbursements.clear();
    this.complianceRecords.clear();
  }
}
