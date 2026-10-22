/**
 * Institution Repository Interface
 *
 * Defines the data access contract for institution operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

/**
 * Institution entity as stored in the database.
 */
export interface InstitutionEntity {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  areaId: string;
  typeId: string;
  sectorId: string;
  ownershipId: string;
  status: 'ACTIVE' | 'INACTIVE';
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  deactivationReason: string | null;
  /** PRC-L322: optimistic-lock version, incremented on every update. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for listing institutions.
 */
export interface InstitutionFilter {
  areaId?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  search?: string;
}

/**
 * Repository interface for institution data access.
 */
export interface InstitutionRepository {
  /** Create a new institution */
  create(data: Omit<InstitutionEntity, 'createdAt' | 'updatedAt'>): Promise<InstitutionEntity>;

  /**
   * Update an existing institution.
   *
   * PRC-L322: when `expectedVersion` is provided, the update is a
   * compare-and-swap against the row's current `version` — returns `null`
   * (instead of throwing) when the version does not match, so the caller can
   * distinguish "not found" from "modified concurrently." When omitted,
   * behavior is unchanged (plain update, no version check).
   */
  update(
    id: string,
    tenantId: string,
    data: Partial<InstitutionEntity>,
    expectedVersion?: number,
  ): Promise<InstitutionEntity | null>;

  /** Find an institution by ID within a tenant */
  findById(id: string, tenantId: string): Promise<InstitutionEntity | null>;

  /**
   * Find an institution by code within a tenant.
   *
   * PRC-M287: the database enforces per-tenant uniqueness
   * (`@@unique([tenantId, code])`), so the in-memory test double scopes by
   * tenant too (it previously enforced a stricter global uniqueness that
   * production never had).
   */
  findByCode(code: string, tenantId: string): Promise<InstitutionEntity | null>;

  /** Find an institution by name within a specific area and tenant */
  findByNameInArea(
    name: string,
    areaId: string,
    tenantId: string,
  ): Promise<InstitutionEntity | null>;

  /** List institutions with pagination and filtering */
  list(
    tenantId: string,
    filter: InstitutionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionEntity>>;

  /** Count active enrollments for an institution (used for deactivation check) */
  countActiveEnrollments(institutionId: string, tenantId: string): Promise<number>;

  /** Count active staff assignments for an institution (used for deactivation check) */
  countActiveStaffAssignments(institutionId: string, tenantId: string): Promise<number>;
}
