/**
 * Registration Repository Interface
 *
 * Public admissions persistence must bind every institution, configuration,
 * application, and idempotency query to one trusted tenant UUID.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type { ListPage } from './pagination.js';
import type { FormConfiguration, InstitutionLocation } from './schemas.js';

export type RegistrationStatus =
  'pending' | 'under_review' | 'approved' | 'rejected' | 'waitlisted';

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
  /** Null only on applications created before migration 097. */
  formConfigurationId: string | null;
  /** Null only on applications created before migration 097. */
  formConfigurationVersion: number | null;
  /** Immutable submit-time evidence; null only on legacy applications. */
  formConfigurationSnapshot: FormConfiguration | null;
  /** Null only on legacy/non-public applications. */
  submissionKey: string | null;
  /** SHA-256 of the canonical material submission payload. */
  submissionPayloadHash: string | null;
  submittedAt: Date;
  updatedAt: Date;
}

export type LegacyRegistrationCreate = Omit<
  RegistrationEntity,
  | 'submittedAt'
  | 'updatedAt'
  | 'formConfigurationId'
  | 'formConfigurationVersion'
  | 'formConfigurationSnapshot'
  | 'submissionKey'
  | 'submissionPayloadHash'
>;

export type NewRegistrationEntity = Omit<
  RegistrationEntity,
  | 'institutionName'
  | 'formConfigurationSnapshot'
  | 'submittedAt'
  | 'updatedAt'
  | 'formConfigurationId'
  | 'formConfigurationVersion'
  | 'submissionKey'
  | 'submissionPayloadHash'
> & {
  formConfigurationId: string;
  formConfigurationVersion: number;
  submissionKey: string;
  submissionPayloadHash: string;
};

export type IdempotentRegistrationCreateResult =
  | { outcome: 'created'; registration: RegistrationEntity }
  | { outcome: 'replayed'; registration: RegistrationEntity }
  | { outcome: 'payload_conflict' }
  | { outcome: 'context_unavailable' };

export interface RegistrationInstitution extends InstitutionLocation {
  tenantId: string;
  status: 'ACTIVE' | 'INACTIVE';
}

/** Test/dev seed shape. Production configurations come only from PostgreSQL. */
export interface TenantFormConfiguration extends FormConfiguration {
  tenantId: string;
}

/** PRC-M051/M056: distinct filter options across a tenant's active institutions. */
export interface InstitutionFilterOptions {
  types: Array<{ id: string; name: string }>;
  areas: Array<{ id: string; name: string }>;
  grades: string[];
}

/** Derive filter options from active institutions (sorted, de-duplicated). */
export function institutionFilterOptionsFrom(
  rows: Array<
    Pick<
      RegistrationInstitution,
      'typeId' | 'typeName' | 'areaId' | 'areaName' | 'availableGrades'
    > & {
      status: string;
    }
  >,
): InstitutionFilterOptions {
  const types = new Map<string, string>();
  const areas = new Map<string, string>();
  const grades = new Set<string>();
  for (const row of rows) {
    if (row.status !== 'ACTIVE') continue;
    if (row.typeId && row.typeName) types.set(row.typeId, row.typeName);
    if (row.areaId && row.areaName) areas.set(row.areaId, row.areaName);
    for (const grade of row.availableGrades ?? []) grades.add(grade);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    types: [...types].map(([id, name]) => ({ id, name })).sort(byName),
    areas: [...areas].map(([id, name]) => ({ id, name })).sort(byName),
    grades: [...grades].sort(),
  };
}

export interface InstitutionLocationFilter {
  areaId?: string;
  typeId?: string;
  gradeId?: string;
  search?: string;
}

export interface SchoolFinderFilter {
  origin?: { latitude: number; longitude: number; radiusKm: number };
  areaIds?: string[];
  schoolTypes?: string[];
  gradeLevels?: string[];
  search?: string;
}

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
  distanceKm?: number;
}

export interface RegistrationRepository {
  /** Authenticated staff enquiry conversion; public callers use createIdempotent. */
  create(entity: LegacyRegistrationCreate): Promise<RegistrationEntity>;

  /**
   * Atomically validate tenant/institution/configuration context, create the
   * application, and reserve `(tenantId, submissionKey)`. Concurrent retries
   * converge on the same row; a material payload change reports a conflict.
   */
  createIdempotent(entity: NewRegistrationEntity): Promise<IdempotentRegistrationCreateResult>;

  findByTrackingNumber(
    trackingNumber: string,
    tenantId?: string,
  ): Promise<RegistrationEntity | null>;

  findById(id: string, tenantId?: string): Promise<RegistrationEntity | null>;

  /** With `page`, returns up to `page.limit + 1` rows (PRC-M337). */
  listByTenant(tenantId: string, page?: ListPage): Promise<RegistrationEntity[]>;

  /**
   * Update status. When `expectedStatus` is given the write only applies if the
   * current status still equals it (PRC-M334 optimistic concurrency); otherwise
   * null is returned.
   */
  updateStatus(
    id: string,
    status: RegistrationStatus,
    remarks?: string,
    tenantId?: string,
    expectedStatus?: RegistrationStatus,
  ): Promise<RegistrationEntity | null>;

  /** Latest or explicitly selected published configuration for this institution. */
  getFormConfiguration(
    tenantId: string,
    institutionId: string,
    configurationId?: string,
  ): Promise<FormConfiguration | null>;

  /** Tenant-scoped authoritative institution lookup (active or inactive). */
  findInstitution(tenantId: string, institutionId: string): Promise<RegistrationInstitution | null>;
  /** PRC-M051/M056: type / area / grade options for the public directory. */
  getInstitutionFilterOptions(tenantId: string): Promise<InstitutionFilterOptions>;

  getInstitutionLocations(
    tenantId: string,
    filter: InstitutionLocationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionLocation>>;

  searchSchools(
    tenantId: string,
    filter: SchoolFinderFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SchoolFinderResultRow>>;
}
