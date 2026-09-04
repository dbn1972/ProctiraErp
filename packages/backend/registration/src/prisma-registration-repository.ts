/**
 * Prisma Registration Repository
 *
 * Production implementation of {@link RegistrationRepository}. Application CRUD
 * maps to `RegistrationApplication` under RLS via {@link withTenantTransaction}.
 *
 * Methods without a tenantId in the signature (`findByTrackingNumber`,
 * `findById`, `updateStatus`, and institution helpers that lack tenant) require
 * {@link PrismaRegistrationRepositoryOptions.defaultTenantId}. Without it they
 * return null / false (same RLS limitation as StaffRepository.findByIdentityNumber).
 *
 * School finder / map / institution helpers read the institution schema
 * (Institution + GeographicArea). Location fields live in `custom_data.__profile`
 * (mirrors PrismaInstitutionRepository). `availableGrades` is read from
 * `custom_data.availableGrades` when present. There is no FormConfiguration
 * table — form configs stay in an optional in-memory seed map.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import { haversineKm } from './in-memory-repository.js';
import type {
  InstitutionLocationFilter,
  RegistrationEntity,
  RegistrationRepository,
  RegistrationStatus,
  SchoolFinderFilter,
  SchoolFinderResultRow,
} from './registration-repository.js';
import type { FormConfiguration, InstitutionLocation } from './schemas.js';

const PROFILE_KEY = '__profile';

export interface PrismaRegistrationRepositoryOptions {
  /**
   * Tenant used for public lookups that omit tenantId from the repository
   * signature (tracking number / status / institution helpers).
   */
  defaultTenantId?: string;
}

interface RegistrationRow {
  id: string;
  tenantId: string;
  trackingNumber: string;
  institutionId: string;
  institutionName: string;
  status: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
  customFields: unknown;
  documents: unknown;
  preferredLanguage: string | null;
  remarks: string | null;
  submittedAt: Date;
  updatedAt: Date;
}

interface InstitutionRow {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  areaId: string;
  type: string;
  status: string;
  customData: unknown;
  area: { name: string } | null;
}

interface ProfileEnvelope {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

function asCustomFields(
  value: unknown,
): RegistrationEntity['customFields'] {
  return Array.isArray(value)
    ? (value as RegistrationEntity['customFields'])
    : [];
}

function asDocuments(value: unknown): RegistrationEntity['documents'] {
  return Array.isArray(value) ? (value as RegistrationEntity['documents']) : [];
}

function toEntity(row: RegistrationRow): RegistrationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    trackingNumber: row.trackingNumber,
    institutionId: row.institutionId,
    institutionName: row.institutionName,
    status: row.status as RegistrationStatus,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth,
    gender: row.gender,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
    guardianEmail: row.guardianEmail,
    customFields: asCustomFields(row.customFields),
    documents: asDocuments(row.documents),
    preferredLanguage: row.preferredLanguage,
    remarks: row.remarks,
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt,
  };
}

function extractProfile(customData: unknown): {
  profile: ProfileEnvelope;
  availableGrades?: string[];
} {
  const raw =
    customData && typeof customData === 'object'
      ? (customData as Record<string, unknown>)
      : {};
  const rawProfile = (raw[PROFILE_KEY] ?? {}) as Partial<ProfileEnvelope>;
  const grades = raw['availableGrades'];
  return {
    profile: {
      latitude: typeof rawProfile.latitude === 'number' ? rawProfile.latitude : null,
      longitude:
        typeof rawProfile.longitude === 'number' ? rawProfile.longitude : null,
      address: typeof rawProfile.address === 'string' ? rawProfile.address : null,
    },
    availableGrades: Array.isArray(grades)
      ? grades.map((g) => String(g))
      : undefined,
  };
}

function isActiveStatus(status: string): boolean {
  return status.toUpperCase() === 'ACTIVE';
}

function toLocation(
  row: InstitutionRow,
): InstitutionLocation & { availableGrades?: string[] } {
  const { profile, availableGrades } = extractProfile(row.customData);
  const loc: InstitutionLocation & { availableGrades?: string[] } = {
    id: row.id,
    name: row.name,
    code: row.code,
    typeId: row.type,
    typeName: row.type,
    areaId: row.areaId,
    areaName: row.area?.name,
    latitude: profile.latitude,
    longitude: profile.longitude,
    address: profile.address,
  };
  if (availableGrades !== undefined) loc.availableGrades = availableGrades;
  return loc;
}

function toFinderRow(
  row: InstitutionRow,
  distanceKm?: number,
): SchoolFinderResultRow {
  const loc = toLocation(row);
  const result: SchoolFinderResultRow = {
    id: loc.id,
    name: loc.name,
    code: loc.code,
    typeId: loc.typeId,
    areaId: loc.areaId,
    latitude: loc.latitude,
    longitude: loc.longitude,
  };
  if (loc.typeName !== undefined) result.typeName = loc.typeName;
  if (loc.areaName !== undefined) result.areaName = loc.areaName;
  if (loc.address !== undefined) result.address = loc.address;
  if (loc.availableGrades !== undefined) result.availableGrades = loc.availableGrades;
  if (distanceKm !== undefined) result.distanceKm = distanceKm;
  return result;
}

export class PrismaRegistrationRepository implements RegistrationRepository {
  private readonly formConfigurations = new Map<string, FormConfiguration>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: PrismaRegistrationRepositoryOptions = {},
  ) {}

  /** Seed form configurations (no FormConfiguration table in schema yet). */
  seedFormConfigurations(configs: FormConfiguration[]): void {
    this.formConfigurations.clear();
    for (const config of configs) {
      this.formConfigurations.set(config.institutionTypeId, config);
    }
  }

  async create(
    entity: Omit<RegistrationEntity, 'submittedAt' | 'updatedAt'>,
  ): Promise<RegistrationEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.registrationApplication.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          trackingNumber: entity.trackingNumber,
          institutionId: entity.institutionId,
          institutionName: entity.institutionName,
          status: entity.status,
          firstName: entity.firstName,
          lastName: entity.lastName,
          dateOfBirth: entity.dateOfBirth,
          gender: entity.gender,
          guardianName: entity.guardianName,
          guardianPhone: entity.guardianPhone,
          guardianEmail: entity.guardianEmail,
          customFields: entity.customFields as Prisma.InputJsonValue,
          documents: entity.documents as Prisma.InputJsonValue,
          preferredLanguage: entity.preferredLanguage,
          remarks: entity.remarks,
          submittedAt: new Date(),
        },
      })) as RegistrationRow;
      return toEntity(row);
    });
  }

  async findByTrackingNumber(
    trackingNumber: string,
  ): Promise<RegistrationEntity | null> {
    const tenantId = this.options.defaultTenantId;
    if (!tenantId) return null;
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.registrationApplication.findFirst({
        where: { trackingNumber, tenantId },
      })) as RegistrationRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async findById(id: string): Promise<RegistrationEntity | null> {
    const tenantId = this.options.defaultTenantId;
    if (!tenantId) return null;
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.registrationApplication.findFirst({
        where: { id, tenantId },
      })) as RegistrationRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async updateStatus(
    id: string,
    status: RegistrationStatus,
    remarks?: string,
  ): Promise<RegistrationEntity | null> {
    const tenantId = this.options.defaultTenantId;
    if (!tenantId) return null;
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.registrationApplication.findFirst({
        where: { id, tenantId },
      })) as RegistrationRow | null;
      if (!existing) return null;

      const data: Prisma.RegistrationApplicationUpdateInput = { status };
      if (remarks !== undefined) data.remarks = remarks;

      const row = (await tx.registrationApplication.update({
        where: { id },
        data,
      })) as RegistrationRow;
      return toEntity(row);
    });
  }

  async getFormConfiguration(
    institutionTypeId: string,
  ): Promise<FormConfiguration | null> {
    return this.formConfigurations.get(institutionTypeId) ?? null;
  }

  async getInstitutionLocations(
    tenantId: string,
    filter: InstitutionLocationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionLocation>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.InstitutionWhereInput = {
        tenantId,
        deletedAt: null,
      };
      if (filter.areaId) where.areaId = filter.areaId;
      if (filter.typeId) where.type = filter.typeId;
      if (filter.search) {
        where.name = { contains: filter.search, mode: 'insensitive' };
      }

      // Status + grade filters applied after fetch (status casing / grades in JSON).
      const rows = (await tx.institution.findMany({
        where,
        include: { area: { select: { name: true } } },
        orderBy: { name: 'asc' },
      })) as InstitutionRow[];

      let filtered = rows.filter((r) => isActiveStatus(r.status));
      if (filter.gradeId) {
        filtered = filtered.filter((r) => {
          const { availableGrades } = extractProfile(r.customData);
          return availableGrades?.includes(filter.gradeId!) ?? false;
        });
      }

      const totalItems = filtered.length;
      const totalPages = Math.ceil(totalItems / pagination.pageSize) || 0;
      const start = (pagination.page - 1) * pagination.pageSize;
      const paged = filtered.slice(start, start + pagination.pageSize);

      return {
        data: paged.map((r) => toLocation(r)),
        meta: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          totalItems,
          totalPages,
        },
      };
    });
  }

  async searchSchools(
    tenantId: string,
    filter: SchoolFinderFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SchoolFinderResultRow>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.InstitutionWhereInput = {
        tenantId,
        deletedAt: null,
      };
      if (filter.areaIds && filter.areaIds.length > 0) {
        where.areaId = { in: filter.areaIds };
      }
      if (filter.schoolTypes && filter.schoolTypes.length > 0) {
        where.type = { in: filter.schoolTypes };
      }
      if (filter.search && filter.search.trim().length > 0) {
        where.name = { contains: filter.search.trim(), mode: 'insensitive' };
      }

      const rows = (await tx.institution.findMany({
        where,
        include: { area: { select: { name: true } } },
      })) as InstitutionRow[];

      let candidates = rows.filter((r) => isActiveStatus(r.status));
      if (filter.gradeLevels && filter.gradeLevels.length > 0) {
        const gradeSet = filter.gradeLevels;
        candidates = candidates.filter((r) => {
          const { availableGrades } = extractProfile(r.customData);
          return (availableGrades ?? []).some((g) => gradeSet.includes(g));
        });
      }

      let scored: SchoolFinderResultRow[];
      if (filter.origin) {
        const { latitude: lat0, longitude: lon0, radiusKm } = filter.origin;
        scored = candidates
          .map((r) => {
            const { profile } = extractProfile(r.customData);
            if (profile.latitude === null || profile.longitude === null) {
              return null;
            }
            const distance = haversineKm(
              lat0,
              lon0,
              profile.latitude,
              profile.longitude,
            );
            if (distance > radiusKm) return null;
            return { row: toFinderRow(r, distance), distance };
          })
          .filter((e): e is { row: SchoolFinderResultRow; distance: number } => e !== null)
          .sort((a, b) => a.distance - b.distance)
          .map((e) => e.row);
      } else {
        scored = candidates
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((r) => toFinderRow(r));
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
    });
  }

  async getInstitutionName(institutionId: string): Promise<string | null> {
    const tenantId = this.options.defaultTenantId;
    if (!tenantId) return null;
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = await tx.institution.findFirst({
        where: { id: institutionId, tenantId, deletedAt: null },
        select: { name: true },
      });
      return row?.name ?? null;
    });
  }

  async isInstitutionActive(institutionId: string): Promise<boolean> {
    const tenantId = this.options.defaultTenantId;
    if (!tenantId) return false;
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = await tx.institution.findFirst({
        where: { id: institutionId, tenantId, deletedAt: null },
        select: { status: true },
      });
      return row ? isActiveStatus(row.status) : false;
    });
  }

  async getInstitutionTypeId(institutionId: string): Promise<string | null> {
    const tenantId = this.options.defaultTenantId;
    if (!tenantId) return null;
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = await tx.institution.findFirst({
        where: { id: institutionId, tenantId, deletedAt: null },
        select: { type: true },
      });
      return row?.type ?? null;
    });
  }
}
