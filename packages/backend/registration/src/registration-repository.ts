/**
 * Registration Repository Interface
 *
 * Defines the data access contract for registration applications.
 * Implementations can be in-memory (testing) or database-backed (production).
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type { FormConfiguration, InstitutionLocation } from './schemas.js';

/**
 * Registration application status values.
 */
export type RegistrationStatus =
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'waitlisted';

/**
 * Stored registration application entity.
 */
export interface RegistrationEntity {
  id: string;
  tenantId: string;
  trackingNumber: string;
  institutionId: string;
  institutionName: string;
  status: RegistrationStatus;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
  customFields: Array<{ fieldId: string; value: string | number | boolean | null }>;
  documents: Array<{
    fileName: string;
    fileType: string;
    fileSize: number;
    documentType: string;
    storagePath?: string;
  }>;
  preferredLanguage: string | null;
  remarks: string | null;
  submittedAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for institution location queries.
 */
export interface InstitutionLocationFilter {
  areaId?: string;
  typeId?: string;
  gradeId?: string;
  search?: string;
}

/**
 * Filter options for the School Finder query.
 *
 * Requirement 16.9: search by geolocation (lat/lon + radius) plus
 * area / type / grade filters. The geolocation block is optional;
 * when present, results are filtered by Haversine distance ≤ radius
 * and sorted by distance ascending.
 */
export interface SchoolFinderFilter {
  origin?: { latitude: number; longitude: number; radiusKm: number };
  areaIds?: string[];
  schoolTypes?: string[];
  gradeLevels?: string[];
  search?: string;
}

/**
 * Result row for the School Finder. `distanceKm` is only populated
 * when the query carried a geolocation block.
 */
export interface SchoolFinderResultRow {
  id: string;
  name: string;
  code: string;
  typeId: string;
  typeName?: string;
  areaId: string;
  areaName?: string;
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  availableGrades?: string[];
  /** Distance from query origin in kilometres, only when origin provided. */
  distanceKm?: number;
}

/**
 * Repository interface for registration data access.
 */
export interface RegistrationRepository {
  /** Create a new registration application */
  create(
    entity: Omit<RegistrationEntity, 'submittedAt' | 'updatedAt'>,
  ): Promise<RegistrationEntity>;

  /** Find a registration by tracking number */
  findByTrackingNumber(trackingNumber: string): Promise<RegistrationEntity | null>;

  /** Find a registration by ID */
  findById(id: string): Promise<RegistrationEntity | null>;

  /** List registrations for a tenant (staff CRM) */
  listByTenant(tenantId: string): Promise<RegistrationEntity[]>;

  /** Update registration status */
  updateStatus(
    id: string,
    status: RegistrationStatus,
    remarks?: string,
  ): Promise<RegistrationEntity | null>;

  /** Get form configuration for an institution type */
  getFormConfiguration(institutionTypeId: string): Promise<FormConfiguration | null>;

  /** Get institution locations with filtering for map display */
  getInstitutionLocations(
    tenantId: string,
    filter: InstitutionLocationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionLocation>>;

  /**
   * Search institutions for the public School Finder. Differs from
   * `getInstitutionLocations` by accepting a geolocation block and
   * returning per-row `distanceKm` when present.
   *
   * Requirement 16.9 / Design §F (`SchoolFinderQuery`).
   */
  searchSchools(
    tenantId: string,
    filter: SchoolFinderFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SchoolFinderResultRow>>;

  /** Get institution name by ID (for response enrichment) */
  getInstitutionName(institutionId: string): Promise<string | null>;

  /** Check if an institution exists and is active */
  isInstitutionActive(institutionId: string): Promise<boolean>;

  /** Get institution type ID for an institution */
  getInstitutionTypeId(institutionId: string): Promise<string | null>;
}
