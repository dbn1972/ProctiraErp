/**
 * Enrollment Repository Interface
 *
 * Defines the data access contract for enrollment operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Requirements: 6.2, 6.3, 6.4
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

/**
 * Enrollment entity as stored in the database.
 */
export interface EnrollmentEntity {
  id: string;
  tenantId: string;
  studentId: string;
  institutionId: string;
  gradeId: string;
  classId: string | null;
  academicPeriodId: string;
  status: 'ENROLLED' | 'TRANSFERRED' | 'WITHDRAWN' | 'GRADUATED';
  enrolledAt: Date;
  exitedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Enrollment status history entry.
 * Requirement 6.2: Record each status change as a history entry.
 */
export interface EnrollmentHistoryEntity {
  id: string;
  /** Tenant of the parent enrollment — bound for RLS before the history insert (G-901 fix). */
  tenantId: string;
  enrollmentId: string;
  previousStatus: string | null;
  newStatus: string;
  effectiveDate: Date;
  institutionId: string;
  academicPeriodId: string;
  reason: string | null;
  createdAt: Date;
}

/**
 * Transfer record linking source and destination institutions.
 * Requirement 6.3: Create a transfer record.
 */
export interface TransferRecordEntity {
  id: string;
  tenantId: string;
  studentId: string;
  sourceInstitutionId: string;
  sourceEnrollmentId: string;
  destinationInstitutionId: string;
  destinationEnrollmentId: string;
  transferDate: Date;
  reason: string;
  createdAt: Date;
}

/**
 * Filter options for listing enrollments.
 */
export interface EnrollmentFilter {
  studentId?: string;
  institutionId?: string;
  academicPeriodId?: string;
  status?: 'ENROLLED' | 'TRANSFERRED' | 'WITHDRAWN' | 'GRADUATED';
}

/**
 * Institution lookup result for transfer validation.
 */
export interface InstitutionLookup {
  id: string;
  status: string;
}

/**
 * Optional enrichment for DB trigger GUCs (`app.enrollment_history_*`).
 * Used when {@link EnrollmentRepository.writesHistoryViaDatabase} is true —
 * must be applied in the same transaction as the enrollment mutate.
 */
export type EnrollmentHistoryContext = {
  reason?: string | null;
  effectiveDate?: Date;
};

/**
 * Repository interface for enrollment data access.
 */
export interface EnrollmentRepository {
  /**
   * When true, Postgres triggers (`trg_enrollments_write_history`) are the
   * authoritative writer of `enrollment_history`. Callers must pass
   * {@link EnrollmentHistoryContext} on create/update and must not call
   * {@link createHistoryEntry} (that path is a no-op / defense-in-depth).
   * In-memory stores leave this falsy and write history in-app.
   */
  readonly writesHistoryViaDatabase?: boolean;

  /** Create a new enrollment */
  createEnrollment(
    data: Omit<EnrollmentEntity, 'createdAt' | 'updatedAt'>,
    history?: EnrollmentHistoryContext,
  ): Promise<EnrollmentEntity>;

  /** Update an existing enrollment */
  updateEnrollment(
    id: string,
    tenantId: string,
    data: Partial<EnrollmentEntity>,
    history?: EnrollmentHistoryContext,
  ): Promise<EnrollmentEntity | null>;

  /** Find an enrollment by ID within a tenant */
  findEnrollmentById(id: string, tenantId: string): Promise<EnrollmentEntity | null>;

  /** Active (ENROLLED) enrollment for a student in an academic period, if any */
  findActiveEnrollment(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<EnrollmentEntity | null>;

  /** List enrollments with pagination and filtering */
  listEnrollments(
    tenantId: string,
    filter: EnrollmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<EnrollmentEntity>>;

  /**
   * Create a history entry for an enrollment status change.
   * In-memory only when {@link writesHistoryViaDatabase}; Pg no-ops.
   */
  createHistoryEntry(
    data: Omit<EnrollmentHistoryEntity, 'createdAt'>,
  ): Promise<EnrollmentHistoryEntity>;

  /** Get enrollment history for a student */
  getEnrollmentHistory(tenantId: string, studentId: string): Promise<EnrollmentHistoryEntity[]>;

  /** Get history entries for a specific enrollment */
  getHistoryByEnrollmentId(enrollmentId: string): Promise<EnrollmentHistoryEntity[]>;

  /** Create a transfer record */
  createTransferRecord(
    data: Omit<TransferRecordEntity, 'createdAt'>,
  ): Promise<TransferRecordEntity>;

  /** Get transfer records for a student */
  getTransferRecords(tenantId: string, studentId: string): Promise<TransferRecordEntity[]>;

  /** Look up an institution by ID (for transfer validation) */
  findInstitutionById(id: string, tenantId: string): Promise<InstitutionLookup | null>;
}
