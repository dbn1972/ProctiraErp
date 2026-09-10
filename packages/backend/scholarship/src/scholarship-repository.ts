/**
 * Scholarship Repository Interface
 *
 * Defines the data access contract for scholarship operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type {
  EligibilityCriteria,
  AcademicRecord,
  FinancialInfo,
  ApplicationDocument,
} from './schemas.js';

// ─── Program Entity ──────────────────────────────────────────────────────────

export type ProgramStatus = 'draft' | 'open' | 'closed' | 'archived';
export type DisbursementFrequency = 'one_time' | 'monthly' | 'quarterly' | 'semester' | 'annual';

export interface ScholarshipProgramEntity {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  applicationStartDate: string;
  applicationEndDate: string;
  totalSlots: number;
  usedSlots: number;
  amountPerRecipient: number;
  currency: string;
  disbursementFrequency: DisbursementFrequency;
  eligibility: EligibilityCriteria;
  status: ProgramStatus;
  academicPeriodId: string | null;
  fundingSourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProgramFilter {
  status?: ProgramStatus;
  search?: string;
}

// ─── Application Entity ──────────────────────────────────────────────────────

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'withdrawn';

export interface ScholarshipApplicationEntity {
  id: string;
  tenantId: string;
  programId: string;
  applicantId: string;
  institutionId: string;
  status: ApplicationStatus;
  academicRecords: AcademicRecord[];
  financialInfo: FinancialInfo;
  documents: ApplicationDocument[];
  personalStatement: string | null;
  areaId: string | null;
  gender: string | null;
  workflowInstanceId: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  /** Actor (JWT `sub`) who approved / rejected — null until a decision is made (G-911). */
  reviewerId: string | null;
  /** Reviewer's note, shown to the school coordinator alongside the decision (G-911). */
  reviewNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationFilter {
  programId?: string;
  applicantId?: string;
  institutionId?: string;
  status?: ApplicationStatus;
  areaId?: string;
  gender?: string;
}

// ─── Disbursement Entity ─────────────────────────────────────────────────────

export type PaymentStatus = 'scheduled' | 'processing' | 'paid' | 'failed' | 'cancelled';
export type PaymentMethod = 'bank_transfer' | 'check' | 'cash' | 'mobile_money';

export interface DisbursementEntity {
  id: string;
  tenantId: string;
  applicationId: string;
  amount: number;
  scheduledDate: string;
  paidDate: string | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  transactionReference: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DisbursementFilter {
  applicationId?: string;
  paymentStatus?: PaymentStatus;
  scheduledDateFrom?: string;
  scheduledDateTo?: string;
}

// ─── Compliance Entity ───────────────────────────────────────────────────────

export type ComplianceType =
  | 'academic_performance'
  | 'attendance'
  | 'community_service'
  | 'report_submission';
export type ComplianceStatus = 'compliant' | 'non_compliant' | 'pending_review';

export interface ComplianceRecordEntity {
  id: string;
  tenantId: string;
  applicationId: string;
  complianceType: ComplianceType;
  status: ComplianceStatus;
  evaluationDate: string;
  details: string | null;
  evaluatorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Report Types ────────────────────────────────────────────────────────────

export interface UtilizationReportData {
  totalPrograms: number;
  totalApplications: number;
  totalApproved: number;
  totalDisbursed: number;
  totalAmount: number;
  currency: string;
  breakdown: UtilizationBreakdownItem[];
}

export interface UtilizationBreakdownItem {
  groupKey: string;
  groupValue: string;
  applicationCount: number;
  approvedCount: number;
  disbursedAmount: number;
  utilizationRate: number;
}

export interface UtilizationReportFilter {
  programId?: string;
  areaId?: string;
  gender?: string;
  institutionId?: string;
  startDate?: string;
  endDate?: string;
  groupBy?: 'program' | 'area' | 'gender' | 'institution';
}

// ─── Repository Interface ────────────────────────────────────────────────────

export interface ScholarshipRepository {
  // Program operations
  createProgram(
    data: Omit<ScholarshipProgramEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScholarshipProgramEntity>;
  updateProgram(
    id: string,
    tenantId: string,
    data: Partial<ScholarshipProgramEntity>,
  ): Promise<ScholarshipProgramEntity | null>;
  findProgramById(id: string, tenantId: string): Promise<ScholarshipProgramEntity | null>;
  listPrograms(
    tenantId: string,
    filter: ProgramFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScholarshipProgramEntity>>;
  deleteProgram(id: string, tenantId: string): Promise<boolean>;

  // Application operations
  createApplication(
    data: Omit<ScholarshipApplicationEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ScholarshipApplicationEntity>;
  updateApplication(
    id: string,
    tenantId: string,
    data: Partial<ScholarshipApplicationEntity>,
  ): Promise<ScholarshipApplicationEntity | null>;
  findApplicationById(id: string, tenantId: string): Promise<ScholarshipApplicationEntity | null>;
  listApplications(
    tenantId: string,
    filter: ApplicationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ScholarshipApplicationEntity>>;
  countApplicationsByProgram(programId: string, tenantId: string): Promise<number>;
  findApplicationByApplicantAndProgram(
    applicantId: string,
    programId: string,
    tenantId: string,
  ): Promise<ScholarshipApplicationEntity | null>;

  // Disbursement operations
  createDisbursement(
    data: Omit<DisbursementEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DisbursementEntity>;
  updateDisbursement(
    id: string,
    tenantId: string,
    data: Partial<DisbursementEntity>,
  ): Promise<DisbursementEntity | null>;
  findDisbursementById(id: string, tenantId: string): Promise<DisbursementEntity | null>;
  listDisbursements(
    tenantId: string,
    filter: DisbursementFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DisbursementEntity>>;
  listDisbursementsByApplication(
    applicationId: string,
    tenantId: string,
  ): Promise<DisbursementEntity[]>;

  // Compliance operations
  createComplianceRecord(
    data: Omit<ComplianceRecordEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ComplianceRecordEntity>;
  listComplianceRecords(applicationId: string, tenantId: string): Promise<ComplianceRecordEntity[]>;

  // Report operations
  getUtilizationReport(
    tenantId: string,
    filter: UtilizationReportFilter,
  ): Promise<UtilizationReportData>;
}
