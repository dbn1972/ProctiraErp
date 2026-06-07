/**
 * Cached Scholarship Repository Decorator
 *
 * Wraps any ScholarshipRepository implementation with a Redis-backed cache layer.
 * Uses read-through caching for getProgramById (findProgramById) queries.
 * Invalidates on program update and delete operations.
 * If no CacheClient is provided, all operations pass through to the delegate.
 */
import type { CacheClient } from '@proctira/cache';
import { tenantKey } from '@proctira/cache';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  ScholarshipRepository,
  ScholarshipProgramEntity,
  ScholarshipApplicationEntity,
  DisbursementEntity,
  ComplianceRecordEntity,
  ProgramFilter,
  ApplicationFilter,
  DisbursementFilter,
  UtilizationReportFilter,
  UtilizationReportData,
} from './scholarship-repository.js';

/** TTL for scholarship program entity cache (5 minutes) */
const PROGRAM_TTL_SECONDS = 300;

export class CachedScholarshipRepository implements ScholarshipRepository {
  constructor(
    private readonly delegate: ScholarshipRepository,
    private readonly cache?: CacheClient,
  ) {}

  // ─── Program operations ────────────────────────────────────────────────────

  async createProgram(data: Omit<ScholarshipProgramEntity, 'createdAt' | 'updatedAt'>): Promise<ScholarshipProgramEntity> {
    return this.delegate.createProgram(data);
  }

  async updateProgram(id: string, tenantId: string, data: Partial<ScholarshipProgramEntity>): Promise<ScholarshipProgramEntity | null> {
    const result = await this.delegate.updateProgram(id, tenantId, data);
    if (result && this.cache) {
      const key = tenantKey(tenantId, 'scholarship-program', id);
      await this.cache.del(key);
    }
    return result;
  }

  async findProgramById(id: string, tenantId: string): Promise<ScholarshipProgramEntity | null> {
    if (!this.cache) {
      return this.delegate.findProgramById(id, tenantId);
    }

    const key = tenantKey(tenantId, 'scholarship-program', id);
    return this.cache.getOrSet(
      key,
      () => this.delegate.findProgramById(id, tenantId),
      PROGRAM_TTL_SECONDS,
    );
  }

  async listPrograms(tenantId: string, filter: ProgramFilter, pagination: PaginationOptions): Promise<PaginatedResult<ScholarshipProgramEntity>> {
    return this.delegate.listPrograms(tenantId, filter, pagination);
  }

  async deleteProgram(id: string, tenantId: string): Promise<boolean> {
    const result = await this.delegate.deleteProgram(id, tenantId);
    if (result && this.cache) {
      const key = tenantKey(tenantId, 'scholarship-program', id);
      await this.cache.del(key);
    }
    return result;
  }

  // ─── Application operations ────────────────────────────────────────────────

  async createApplication(data: Omit<ScholarshipApplicationEntity, 'createdAt' | 'updatedAt'>): Promise<ScholarshipApplicationEntity> {
    return this.delegate.createApplication(data);
  }

  async updateApplication(id: string, tenantId: string, data: Partial<ScholarshipApplicationEntity>): Promise<ScholarshipApplicationEntity | null> {
    return this.delegate.updateApplication(id, tenantId, data);
  }

  async findApplicationById(id: string, tenantId: string): Promise<ScholarshipApplicationEntity | null> {
    return this.delegate.findApplicationById(id, tenantId);
  }

  async listApplications(tenantId: string, filter: ApplicationFilter, pagination: PaginationOptions): Promise<PaginatedResult<ScholarshipApplicationEntity>> {
    return this.delegate.listApplications(tenantId, filter, pagination);
  }

  async countApplicationsByProgram(programId: string, tenantId: string): Promise<number> {
    return this.delegate.countApplicationsByProgram(programId, tenantId);
  }

  async findApplicationByApplicantAndProgram(applicantId: string, programId: string, tenantId: string): Promise<ScholarshipApplicationEntity | null> {
    return this.delegate.findApplicationByApplicantAndProgram(applicantId, programId, tenantId);
  }

  // ─── Disbursement operations ───────────────────────────────────────────────

  async createDisbursement(data: Omit<DisbursementEntity, 'createdAt' | 'updatedAt'>): Promise<DisbursementEntity> {
    return this.delegate.createDisbursement(data);
  }

  async updateDisbursement(id: string, tenantId: string, data: Partial<DisbursementEntity>): Promise<DisbursementEntity | null> {
    return this.delegate.updateDisbursement(id, tenantId, data);
  }

  async findDisbursementById(id: string, tenantId: string): Promise<DisbursementEntity | null> {
    return this.delegate.findDisbursementById(id, tenantId);
  }

  async listDisbursements(tenantId: string, filter: DisbursementFilter, pagination: PaginationOptions): Promise<PaginatedResult<DisbursementEntity>> {
    return this.delegate.listDisbursements(tenantId, filter, pagination);
  }

  async listDisbursementsByApplication(applicationId: string, tenantId: string): Promise<DisbursementEntity[]> {
    return this.delegate.listDisbursementsByApplication(applicationId, tenantId);
  }

  // ─── Compliance operations ─────────────────────────────────────────────────

  async createComplianceRecord(data: Omit<ComplianceRecordEntity, 'createdAt' | 'updatedAt'>): Promise<ComplianceRecordEntity> {
    return this.delegate.createComplianceRecord(data);
  }

  async listComplianceRecords(applicationId: string, tenantId: string): Promise<ComplianceRecordEntity[]> {
    return this.delegate.listComplianceRecords(applicationId, tenantId);
  }

  // ─── Report operations ─────────────────────────────────────────────────────

  async getUtilizationReport(tenantId: string, filter: UtilizationReportFilter): Promise<UtilizationReportData> {
    return this.delegate.getUtilizationReport(tenantId, filter);
  }
}
