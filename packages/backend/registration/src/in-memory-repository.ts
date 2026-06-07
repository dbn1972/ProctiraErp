/**
 * In-Memory Registration Repository
 *
 * Used for unit testing without database dependencies.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type { FormConfiguration, InstitutionLocation } from './schemas.js';
import type {
  RegistrationEntity,
  RegistrationRepository,
  RegistrationStatus,
  InstitutionLocationFilter,
  SchoolFinderFilter,
  SchoolFinderResultRow,
} from './registration-repository.js';

/**
 * In-memory institution record for testing.
 */
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

/**
 * Great-circle distance between two lat/lon points in kilometres.
 * Uses the Haversine formula. Inputs are degrees.
 *
 * Exported so the production repository implementation (and tests)
 * can reuse the same maths the in-memory store uses.
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's mean radius (km)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a =
    sinLat * sinLat +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * In-memory implementation of RegistrationRepository for testing.
 */
export class InMemoryRegistrationRepository implements RegistrationRepository {
  private registrations: RegistrationEntity[] = [];
  private institutions: InMemoryInstitution[] = [];
  private formConfigurations: FormConfiguration[] = [];

  /** Seed institutions for testing */
  seedInstitutions(institutions: InMemoryInstitution[]): void {
    this.institutions = [...institutions];
  }

  /** Seed form configurations for testing */
  seedFormConfigurations(configs: FormConfiguration[]): void {
    this.formConfigurations = [...configs];
  }

  /** Get all registrations (for test assertions) */
  getAll(): RegistrationEntity[] {
    return [...this.registrations];
  }

  /** Clear all data */
  clear(): void {
    this.registrations = [];
  }

  async create(
    entity: Omit<RegistrationEntity, 'submittedAt' | 'updatedAt'>,
  ): Promise<RegistrationEntity> {
    const now = new Date();
    const registration: RegistrationEntity = {
      ...entity,
      submittedAt: now,
      updatedAt: now,
    };
    this.registrations.push(registration);
    return registration;
  }

  async findByTrackingNumber(trackingNumber: string): Promise<RegistrationEntity | null> {
    return this.registrations.find((r) => r.trackingNumber === trackingNumber) ?? null;
  }

  async findById(id: string): Promise<RegistrationEntity | null> {
    return this.registrations.find((r) => r.id === id) ?? null;
  }

  async updateStatus(
    id: string,
    status: RegistrationStatus,
    remarks?: string,
  ): Promise<RegistrationEntity | null> {
    const index = this.registrations.findIndex((r) => r.id === id);
    if (index === -1) return null;

    const registration = this.registrations[index]!;
    registration.status = status;
    registration.updatedAt = new Date();
    if (remarks !== undefined) {
      registration.remarks = remarks;
    }
    return registration;
  }

  async getFormConfiguration(institutionTypeId: string): Promise<FormConfiguration | null> {
    return this.formConfigurations.find((c) => c.institutionTypeId === institutionTypeId) ?? null;
  }

  async getInstitutionLocations(
    tenantId: string,
    filter: InstitutionLocationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionLocation>> {
    let filtered = this.institutions.filter((i) => i.tenantId === tenantId && i.status === 'ACTIVE');

    if (filter.areaId) {
      filtered = filtered.filter((i) => i.areaId === filter.areaId);
    }
    if (filter.typeId) {
      filtered = filtered.filter((i) => i.typeId === filter.typeId);
    }
    if (filter.gradeId) {
      filtered = filtered.filter((i) => i.availableGrades?.includes(filter.gradeId!) ?? false);
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter((i) => i.name.toLowerCase().includes(searchLower));
    }

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / pagination.pageSize);
    const start = (pagination.page - 1) * pagination.pageSize;
    const paged = filtered.slice(start, start + pagination.pageSize);

    return {
      data: paged.map((i) => ({
        id: i.id,
        name: i.name,
        code: i.code,
        typeId: i.typeId,
        typeName: i.typeName,
        areaId: i.areaId,
        areaName: i.areaName,
        latitude: i.latitude,
        longitude: i.longitude,
        address: i.address,
        availableGrades: i.availableGrades,
      })),
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  async getInstitutionName(institutionId: string): Promise<string | null> {
    const institution = this.institutions.find((i) => i.id === institutionId);
    return institution?.name ?? null;
  }

  /**
   * Search institutions for the School Finder.
   *
   * Filtering rules (Requirement 16.9, Design §F):
   *   • Restricted to active institutions for the tenant.
   *   • If `origin` is provided, filter by Haversine distance ≤ radius
   *     and sort ascending by distance. Institutions missing a
   *     latitude/longitude are excluded from geolocation queries
   *     (we cannot rank them).
   *   • Without `origin`, sort alphabetically by name.
   *   • Multiple area / type / grade filters are OR within a list
   *     and AND across lists ("any of these areas AND any of these
   *     types AND offers any of these grades").
   *   • `search` matches a case-insensitive substring of the name.
   */
  async searchSchools(
    tenantId: string,
    filter: SchoolFinderFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SchoolFinderResultRow>> {
    let candidates = this.institutions.filter(
      (i) => i.tenantId === tenantId && i.status === 'ACTIVE',
    );

    if (filter.areaIds && filter.areaIds.length > 0) {
      const areaSet = new Set(filter.areaIds);
      candidates = candidates.filter((i) => areaSet.has(i.areaId));
    }
    if (filter.schoolTypes && filter.schoolTypes.length > 0) {
      const typeSet = new Set(filter.schoolTypes);
      candidates = candidates.filter((i) => typeSet.has(i.typeId));
    }
    if (filter.gradeLevels && filter.gradeLevels.length > 0) {
      const gradeSet = filter.gradeLevels;
      candidates = candidates.filter((i) =>
        (i.availableGrades ?? []).some((g) => gradeSet.includes(g)),
      );
    }
    if (filter.search && filter.search.trim().length > 0) {
      const needle = filter.search.toLowerCase();
      candidates = candidates.filter((i) => i.name.toLowerCase().includes(needle));
    }

    let scored: SchoolFinderResultRow[];
    if (filter.origin) {
      const { latitude: lat0, longitude: lon0, radiusKm } = filter.origin;
      scored = candidates
        .filter(
          (i): i is InMemoryInstitution & { latitude: number; longitude: number } =>
            i.latitude !== null && i.longitude !== null,
        )
        .map((i) => ({
          row: this.toResultRow(i, haversineKm(lat0, lon0, i.latitude, i.longitude)),
          distance: haversineKm(lat0, lon0, i.latitude, i.longitude),
        }))
        .filter((entry) => entry.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance)
        .map((entry) => entry.row);
    } else {
      scored = candidates
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => this.toResultRow(i));
    }

    const totalItems = scored.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
    const start = (pagination.page - 1) * pagination.pageSize;
    const paged = scored.slice(start, start + pagination.pageSize);

    return {
      data: paged,
      meta: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  private toResultRow(
    inst: InMemoryInstitution,
    distanceKm?: number,
  ): SchoolFinderResultRow {
    const row: SchoolFinderResultRow = {
      id: inst.id,
      name: inst.name,
      code: inst.code,
      typeId: inst.typeId,
      areaId: inst.areaId,
      latitude: inst.latitude,
      longitude: inst.longitude,
    };
    if (inst.typeName !== undefined) row.typeName = inst.typeName;
    if (inst.areaName !== undefined) row.areaName = inst.areaName;
    if (inst.address !== undefined) row.address = inst.address;
    if (inst.availableGrades !== undefined) row.availableGrades = inst.availableGrades;
    if (distanceKm !== undefined) row.distanceKm = distanceKm;
    return row;
  }

  async isInstitutionActive(institutionId: string): Promise<boolean> {
    const institution = this.institutions.find((i) => i.id === institutionId);
    return institution?.status === 'ACTIVE';
  }

  async getInstitutionTypeId(institutionId: string): Promise<string | null> {
    const institution = this.institutions.find((i) => i.id === institutionId);
    return institution?.typeId ?? null;
  }
}
