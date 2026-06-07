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
  subjectId: string;
  classId: string;
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
 * Repository interface for staff assignment data access.
 */
export interface StaffAssignmentRepository {
  /** Create a new staff assignment */
  create(data: Omit<StaffAssignmentEntity, 'createdAt' | 'updatedAt'>): Promise<StaffAssignmentEntity>;

  /** Update an existing staff assignment */
  update(id: string, tenantId: string, data: Partial<StaffAssignmentEntity>): Promise<StaffAssignmentEntity | null>;

  /** Find an assignment by ID within a tenant */
  findById(id: string, tenantId: string): Promise<StaffAssignmentEntity | null>;

  /** Find active assignments for a staff member */
  findActiveByStaffId(staffId: string, tenantId: string): Promise<StaffAssignmentEntity[]>;

  /**
   * Find overlapping assignments for the same staff member at the same
   * institution-subject-class combination within a date range.
   * Used to enforce the non-overlap constraint (Requirement 7.2).
   */
  findOverlapping(
    tenantId: string,
    staffId: string,
    institutionId: string,
    subjectId: string,
    classId: string,
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

  /** Delete an assignment */
  delete(id: string, tenantId: string): Promise<boolean>;
}
