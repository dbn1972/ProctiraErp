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
  /** Major currency units (display / API compat). Always reconciles with amountPerRecipientCents. */
  amountPerRecipient: number;
  /** W1-DATA-09: integer cents — ledger / netting source of truth. */
  amountPerRecipientCents: number;
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
  'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'withdrawn';

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
  /** Any of these applicants (PRC-L346: single query for a parent's children). */
  applicantIds?: string[];
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
  /** Major currency units (NUMERIC). */
  amount: number;
  /** W2-FIN-08: integer cents reconciled from amount. */
  amountCents: number;
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
  'academic_performance' | 'attendance' | 'community_service' | 'report_submission';
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
  /** Major units derived from totalAmountCents (API/UI compat). */
  totalAmount: number;
  /** W1-DATA-09: paid disbursements summed in integer cents. */
  totalAmountCents: number;
  /** Single currency, 'MIXED' when paid totals span currencies (see currencyTotals). */
  currency: string;
  /** PRC-M352: paid totals per programme currency. */
  currencyTotals: { currency: string; totalAmountCents: number; totalAmount: number }[];
  breakdown: UtilizationBreakdownItem[];
}

export interface UtilizationBreakdownItem {
  groupKey: string;
  groupValue: string;
  applicationCount: number;
  approvedCount: number;
  /** Major units derived from disbursedAmountCents. */
  disbursedAmount: number;
  /** W1-DATA-09: group paid total in integer cents. */
  disbursedAmountCents: number;
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

// ─── Atomic approval (PRC-H083) ──────────────────────────────────────────────

/** Statuses from which an application may be approved. */
export const APPROVABLE_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'submitted',
  'under_review',
];

export interface ApproveApplicationCommand {
  reviewedAt: Date;
  reviewerId: string | null;
  reviewNotes: string | null;
  /**
   * When set, the on-approval instalment is inserted in the same transaction.
   * Amount is taken from the locked program row (amountPerRecipientCents).
   */
  firstDisbursement: { id: string; scheduledDate: string; notes: string } | null;
}

export type ApproveApplicationOutcome =
  | {
      kind: 'approved';
      application: ScholarshipApplicationEntity;
      program: ScholarshipProgramEntity;
      disbursement: DisbursementEntity | null;
    }
  | { kind: 'application_not_found' }
  | { kind: 'program_not_found' }
  | { kind: 'invalid_status'; status: ApplicationStatus }
  | { kind: 'no_slots' };

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
  /**
   * PRC-H083: status guard + slot increment + application update + optional
   * first disbursement as ONE atomic unit. Implementations must not allow two
   * concurrent callers to both approve the same application or to push
   * used_slots past total_slots.
   */
  approveApplicationAtomic(
    id: string,
    tenantId: string,
    command: ApproveApplicationCommand,
  ): Promise<ApproveApplicationOutcome>;
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
