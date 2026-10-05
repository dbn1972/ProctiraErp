/**
 * Staff Assignment Repository Interface
 *
 * Defines the data access contract for staff assignment operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Requirements:
 * - 7.2: Track staff assignments to institutions, subjects, and classes with start/end dates
 * - 7.5: Track each assignment independently with role and time allocation as percentage
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

/**
 * Staff assignment entity as stored in the database.
 */
export interface StaffAssignmentEntity {
  id: string;
  tenantId: string;
  staffId: string;
  institutionId: string;
  /** NULL for administrative assignments (principal, additional charge) — db/sql/098. */
  subjectId: string | null;
  /** NULL for administrative assignments — db/sql/098. */
  classId: string | null;
  role: string;
  allocationPercentage: number; // 1-100
  startDate: string; // ISO date string (YYYY-MM-DD)
  endDate: string | null; // ISO date string or null for ongoing
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for listing staff assignments.
 */
export interface StaffAssignmentFilter {
  staffId?: string;
  institutionId?: string;
  subjectId?: string;
  classId?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

/**
 * PRC-M375: allocation cap enforced by the repository inside the write
 * transaction (staff row locked), counting only ACTIVE assignments whose
 * period overlaps the new/updated one.
 */
export interface AllocationGuard {
  maxTotalPercentage: number;
}

export class AllocationExceededError extends Error {
  constructor(
    public readonly currentTotal: number,
    public readonly requested: number,
    public readonly maxTotal: number,
  ) {
    super(
      `Total allocation would exceed ${maxTotal}%. Current overlapping allocation: ${currentTotal}%, requested: ${requested}%, total would be: ${currentTotal + requested}%`,
    );
    this.name = 'AllocationExceededError';
  }
}

/** Two date ranges overlap (null end = open-ended); shared by all implementations. */
export function assignmentDatesOverlap(
  start1: string,
  end1: string | null,
  start2: string,
  end2: string | null,
): boolean {
  const start1BeforeEnd2 = end2 === null || start1 < end2;
  const start2BeforeEnd1 = end1 === null || start2 < end1;
  return start1BeforeEnd2 && start2BeforeEnd1;
}

/**
 * Throws {@link AllocationExceededError} when `candidate` (if ACTIVE) plus the
 * other ACTIVE assignments overlapping its period exceed the guard.
 */
export function assertAllocationFits(
  others: readonly StaffAssignmentEntity[],
  candidate: Pick<
    StaffAssignmentEntity,
    'id' | 'allocationPercentage' | 'startDate' | 'endDate' | 'status'
  >,
  guard: AllocationGuard,
): void {
  if (candidate.status !== 'ACTIVE') return;
  const currentTotal = others
    .filter(
      (a) =>
        a.id !== candidate.id &&
        a.status === 'ACTIVE' &&
        assignmentDatesOverlap(a.startDate, a.endDate, candidate.startDate, candidate.endDate),
    )
    .reduce((sum, a) => sum + a.allocationPercentage, 0);
  if (currentTotal + candidate.allocationPercentage > guard.maxTotalPercentage) {
    throw new AllocationExceededError(
      currentTotal,
      candidate.allocationPercentage,
      guard.maxTotalPercentage,
    );
  }
}

/**
 * Repository interface for staff assignment data access.
 */
export interface StaffAssignmentRepository {
  /** Create a new staff assignment */
  create(
    data: Omit<StaffAssignmentEntity, 'createdAt' | 'updatedAt'>,
    guard?: AllocationGuard,
  ): Promise<StaffAssignmentEntity>;

  /** Update an existing staff assignment */
  update(
    id: string,
    tenantId: string,
    data: Partial<StaffAssignmentEntity>,
    guard?: AllocationGuard,
  ): Promise<StaffAssignmentEntity | null>;

  /** Find an assignment by ID within a tenant */
  findById(id: string, tenantId: string): Promise<StaffAssignmentEntity | null>;

  /** Find active assignments for a staff member */
  findActiveByStaffId(staffId: string, tenantId: string): Promise<StaffAssignmentEntity[]>;

  /**
   * Find overlapping assignments for the same staff member at the same
   * institution-subject-class combination within a date range.
   * Used to enforce the non-overlap constraint (Requirement 7.2).
   * A null subject/class matches only rows where that column IS NULL.
   */
  findOverlapping(
    tenantId: string,
    staffId: string,
    institutionId: string,
    subjectId: string | null,
    classId: string | null,
    startDate: string,
    endDate: string | null,
    excludeId?: string,
  ): Promise<StaffAssignmentEntity[]>;

  /** List assignments with pagination and filtering */
  list(
    tenantId: string,
    filter: StaffAssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StaffAssignmentEntity>>;

  /**
   * PRC-M375: end an assignment (status INACTIVE, end-dated) — history is kept.
   * Returns false when the assignment does not exist in the tenant.
   */
  delete(id: string, tenantId: string): Promise<boolean>;
}
