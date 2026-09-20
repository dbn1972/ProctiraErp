/**
 * In-memory registration repository for explicit development/unit-test use.
 * Production composition selects the PostgreSQL implementation.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  IdempotentRegistrationCreateResult,
  InstitutionLocationFilter,
  LegacyRegistrationCreate,
  NewRegistrationEntity,
  RegistrationEntity,
  RegistrationInstitution,
  RegistrationRepository,
  RegistrationStatus,
  SchoolFinderFilter,
  SchoolFinderResultRow,
  TenantFormConfiguration,
} from './registration-repository.js';
import type { FormConfiguration, InstitutionLocation } from './schemas.js';

export interface InMemoryInstitution {
  id: string;
  name: string;
  code: string;
  typeId: string;
  typeName?: string;
  areaId: string;
  areaName?: string;
  tenantId: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  availableGrades?: string[];
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radiusKm = 6371;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class InMemoryRegistrationRepository implements RegistrationRepository {
  private registrations: RegistrationEntity[] = [];
  private institutions: InMemoryInstitution[] = [];
  private formConfigurations: TenantFormConfiguration[] = [];

  seedInstitutions(institutions: InMemoryInstitution[]): void {
    this.institutions = structuredClone(institutions);
  }

  seedFormConfigurations(configurations: TenantFormConfiguration[]): void {
    this.formConfigurations = structuredClone(configurations);
  }

  getAll(): RegistrationEntity[] {
    return structuredClone(this.registrations);
  }

  clear(): void {
    this.registrations = [];
  }

  async create(entity: LegacyRegistrationCreate): Promise<RegistrationEntity> {
    const now = new Date();
    const registration: RegistrationEntity = {
      ...structuredClone(entity),
      formConfigurationId: null,
      formConfigurationVersion: null,
      formConfigurationSnapshot: null,
      submissionKey: null,
      submissionPayloadHash: null,
      submittedAt: now,
      updatedAt: now,
    };
    this.registrations.push(registration);
    return structuredClone(registration);
  }

  async createIdempotent(
    entity: NewRegistrationEntity,
  ): Promise<IdempotentRegistrationCreateResult> {
    const existing = this.registrations.find(
      (row) => row.tenantId === entity.tenantId && row.submissionKey === entity.submissionKey,
    );
    if (existing) {
      return existing.submissionPayloadHash === entity.submissionPayloadHash
        ? { outcome: 'replayed', registration: structuredClone(existing) }
        : { outcome: 'payload_conflict' };
    }

    const institution = this.institutions.find(
      (row) => row.tenantId === entity.tenantId && row.id === entity.institutionId,
    );
    const configuration = this.formConfigurations.find(
      (row) =>
        row.tenantId === entity.tenantId &&
        row.institutionId === entity.institutionId &&
        row.id === entity.formConfigurationId &&
        row.version === entity.formConfigurationVersion,
    );
    if (!institution || institution.status.toUpperCase() !== 'ACTIVE' || !configuration) {
      return { outcome: 'context_unavailable' };
    }

    const { tenantId: _tenantId, ...snapshot } = configuration;
    const now = new Date();
    const registration: RegistrationEntity = {
      ...structuredClone(entity),
      institutionName: institution.name,
      formConfigurationSnapshot: structuredClone(snapshot),
      submittedAt: now,
      updatedAt: now,
    };
    this.registrations.push(registration);
    return { outcome: 'created', registration: structuredClone(registration) };
  }

  async findByTrackingNumber(
    trackingNumber: string,
    tenantId?: string,
  ): Promise<RegistrationEntity | null> {
    const row = this.registrations.find(
      (registration) =>
        registration.trackingNumber === trackingNumber &&
        (!tenantId || registration.tenantId === tenantId),
    );
    return row ? structuredClone(row) : null;
  }

  async findById(id: string, tenantId?: string): Promise<RegistrationEntity | null> {
    const row = this.registrations.find(
      (registration) => registration.id === id && (!tenantId || registration.tenantId === tenantId),
    );
    return row ? structuredClone(row) : null;
  }

  async listByTenant(tenantId: string): Promise<RegistrationEntity[]> {
    return this.registrations
      .filter((registration) => registration.tenantId === tenantId)
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
      .map((registration) => structuredClone(registration));
  }

  async updateStatus(
    id: string,
    status: RegistrationStatus,
    remarks?: string,
    tenantId?: string,
  ): Promise<RegistrationEntity | null> {
    const registration = this.registrations.find(
      (row) => row.id === id && (!tenantId || row.tenantId === tenantId),
    );
    if (!registration) return null;
    registration.status = status;
    registration.updatedAt = new Date();
    if (remarks !== undefined) registration.remarks = remarks;
    return structuredClone(registration);
  }

  async getFormConfiguration(
    tenantId: string,
    institutionId: string,
    configurationId?: string,
  ): Promise<FormConfiguration | null> {
    const matches = this.formConfigurations
      .filter(
        (configuration) =>
          configuration.tenantId === tenantId &&
          configuration.institutionId === institutionId &&
          (!configurationId || configuration.id === configurationId),
      )
      .sort((a, b) => b.version - a.version);
    const configuration = matches[0];
    if (!configuration) return null;
    const { tenantId: _tenantId, ...publicConfiguration } = configuration;
    return structuredClone(publicConfiguration);
  }

  async findInstitution(
    tenantId: string,
    institutionId: string,
  ): Promise<RegistrationInstitution | null> {
    const institution = this.institutions.find(
      (row) => row.tenantId === tenantId && row.id === institutionId,
    );
    return institution ? this.toInstitution(institution) : null;
  }

  async getInstitutionLocations(
    tenantId: string,
    filter: InstitutionLocationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionLocation>> {
    let filtered = this.activeInstitutions(tenantId);
    if (filter.areaId) filtered = filtered.filter((row) => row.areaId === filter.areaId);
    if (filter.typeId) filtered = filtered.filter((row) => row.typeId === filter.typeId);
    if (filter.gradeId) {
      filtered = filtered.filter((row) => row.availableGrades?.includes(filter.gradeId!) ?? false);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      filtered = filtered.filter((row) => row.name.toLowerCase().includes(search));
    }

    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
    const start = (pagination.page - 1) * pagination.pageSize;
    return {
      data: filtered.slice(start, start + pagination.pageSize).map((row) => this.toLocation(row)),
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  async searchSchools(
    tenantId: string,
    filter: SchoolFinderFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SchoolFinderResultRow>> {
    let candidates = this.activeInstitutions(tenantId);
    if (filter.areaIds?.length) {
      const values = new Set(filter.areaIds);
      candidates = candidates.filter((row) => values.has(row.areaId));
    }
    if (filter.schoolTypes?.length) {
      const values = new Set(filter.schoolTypes);
      candidates = candidates.filter((row) => values.has(row.typeId));
    }
    if (filter.gradeLevels?.length) {
      candidates = candidates.filter((row) =>
        (row.availableGrades ?? []).some((grade) => filter.gradeLevels!.includes(grade)),
      );
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      candidates = candidates.filter((row) => row.name.toLowerCase().includes(search));
    }

    let rows: SchoolFinderResultRow[];
    if (filter.origin) {
      const { latitude, longitude, radiusKm } = filter.origin;
      rows = candidates
        .filter(
          (row): row is InMemoryInstitution & { latitude: number; longitude: number } =>
            row.latitude !== null && row.longitude !== null,
        )
        .map((row) => ({
          row: this.toResultRow(row, haversineKm(latitude, longitude, row.latitude, row.longitude)),
          distance: haversineKm(latitude, longitude, row.latitude, row.longitude),
        }))
        .filter(({ distance }) => distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance)
        .map(({ row }) => row);
    } else {
      rows = candidates
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => this.toResultRow(row));
    }

    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
    const start = (pagination.page - 1) * pagination.pageSize;
    return {
      data: rows.slice(start, start + pagination.pageSize),
      meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems, totalPages },
    };
  }

  private activeInstitutions(tenantId: string): InMemoryInstitution[] {
    return this.institutions.filter(
      (row) => row.tenantId === tenantId && row.status.toUpperCase() === 'ACTIVE',
    );
  }

  private toInstitution(row: InMemoryInstitution): RegistrationInstitution {
    return {
      ...this.toLocation(row),
      tenantId: row.tenantId,
      status: row.status.toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    };
  }

  private toLocation(row: InMemoryInstitution): InstitutionLocation {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      typeId: row.typeId,
      typeName: row.typeName,
      areaId: row.areaId,
      areaName: row.areaName,
      latitude: row.latitude,
      longitude: row.longitude,
      address: row.address,
      availableGrades: row.availableGrades,
    };
  }

  private toResultRow(row: InMemoryInstitution, distanceKm?: number): SchoolFinderResultRow {
    return { ...this.toLocation(row), ...(distanceKm === undefined ? {} : { distanceKm }) };
  }
}
