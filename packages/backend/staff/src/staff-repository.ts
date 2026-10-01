/**
 * Staff Repository Interface
 *
 * Defines the data access contract for staff operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

/**
 * Staff entity as stored in the database.
 */
export interface StaffEntity {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO date string (YYYY-MM-DD)
  identityNumber: string;
  contactPhone: string;
  contactEmail: string | null;
  position: string;
  status: 'ACTIVE' | 'INACTIVE';
  customData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for listing staff.
 */
export interface StaffFilter {
  status?: 'ACTIVE' | 'INACTIVE';
  position?: string;
  search?: string; // Full-text search on name and identity number
  /** When set, only staff with an assignment at this institution are returned. */
  institutionId?: string;
}

/**
 * Repository interface for staff data access.
 */
export interface StaffRepository {
  /** Create a new staff record */
  create(data: Omit<StaffEntity, 'createdAt' | 'updatedAt'>): Promise<StaffEntity>;

  /** Update an existing staff record */
  update(id: string, tenantId: string, data: Partial<StaffEntity>): Promise<StaffEntity | null>;

  /** Find a staff record by ID within a tenant */
  findById(id: string, tenantId: string): Promise<StaffEntity | null>;

  /** Find a staff record by identity number (globally unique across all staff) */
  findByIdentityNumber(identityNumber: string): Promise<StaffEntity | null>;

  /** List staff with pagination and filtering */
  list(
    tenantId: string,
    filter: StaffFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StaffEntity>>;

  /** Delete a staff record */
  delete(id: string, tenantId: string): Promise<boolean>;

  /**
   * PRC-L157: count dependent HR records (payroll lines, contracts, attendance, leave,
   * appraisals, training) keyed by kind. Staff with dependents must be offboarded, not deleted.
   */
  countDependents?(id: string, tenantId: string): Promise<Record<string, number>>;

  /** PRC-L153: ids (of `ids`) that exist and are not deleted for the tenant — one query. */
  findExistingIds?(ids: readonly string[], tenantId: string): Promise<string[]>;

  /**
   * PRC-L153: hard-remove a row this request just created (compensating rollback when a
   * dependent write in another store fails). Never use for user-initiated deletes.
   */
  purgeCreated?(id: string, tenantId: string): Promise<void>;
}
