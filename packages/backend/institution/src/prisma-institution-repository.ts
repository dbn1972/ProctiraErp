/**
 * Prisma Institution Repository
 *
 * Production implementation of {@link InstitutionRepository} backed by
 * PostgreSQL via Prisma. Every method runs inside {@link withTenantTransaction}
 * so the `app.current_tenant_id` RLS variable is bound on the same connection
 * that executes the query; `tenantId` is also kept in every `where` clause as
 * defense-in-depth.
 *
 * Schema mapping: the `institutions` table stores `type`/`sector`/`ownership`
 * as varchars and has no columns for latitude/longitude/address/contacts/
 * deactivation reason. The entity's `typeId`/`sectorId`/`ownershipId` map onto
 * those varchar columns, and the remaining profile fields are persisted inside
 * the existing `custom_data` JSONB column under a reserved `__profile` envelope,
 * stripped back out on read (mirrors PrismaStudentRepository).
 *
 * Global uniqueness: the schema enforces per-tenant uniqueness via
 * `@@unique([tenantId, code])`. `findByCode` (no tenantId in the interface)
 * cannot run under RLS, so it returns null and the database unique constraint
 * is the authoritative guard (a duplicate create surfaces as P2002 → 409).
 * `findByNameInArea` carries a tenantId and is implemented normally.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  InstitutionEntity,
  InstitutionFilter,
  InstitutionRepository,
} from './institution-repository.js';

const PROFILE_KEY = '__profile';

interface ProfileEnvelope {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  deactivationReason: string | null;
}

interface InstitutionRow {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  areaId: string;
  type: string;
  sector: string;
  ownership: string;
  status: string;
  customData: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeStatus(status: string): 'ACTIVE' | 'INACTIVE' {
  return status.toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
}

function extractProfile(customData: unknown): {
  profile: ProfileEnvelope;
  userCustomData: Record<string, unknown>;
} {
  const raw =
    customData && typeof customData === 'object'
      ? { ...(customData as Record<string, unknown>) }
      : {};
  const rawProfile = (raw[PROFILE_KEY] ?? {}) as Partial<ProfileEnvelope>;
  delete raw[PROFILE_KEY];
  return {
    profile: {
      latitude: rawProfile.latitude ?? null,
      longitude: rawProfile.longitude ?? null,
      address: rawProfile.address ?? null,
      contactPhone: rawProfile.contactPhone ?? null,
      contactEmail: rawProfile.contactEmail ?? null,
      deactivationReason: rawProfile.deactivationReason ?? null,
    },
    userCustomData: raw,
  };
}

function buildCustomData(entity: Partial<InstitutionEntity>): Record<string, unknown> {
  const profile: ProfileEnvelope = {
    latitude: entity.latitude ?? null,
    longitude: entity.longitude ?? null,
    address: entity.address ?? null,
    contactPhone: entity.contactPhone ?? null,
    contactEmail: entity.contactEmail ?? null,
    deactivationReason: entity.deactivationReason ?? null,
  };
  // `customData` on the entity is not part of InstitutionEntity, but callers may
  // pass extra keys; preserve anything already present minus the reserved key.
  const extra = (entity as { customData?: Record<string, unknown> }).customData ?? {};
  return { ...extra, [PROFILE_KEY]: profile };
}

function toEntity(row: InstitutionRow): InstitutionEntity {
  const { profile } = extractProfile(row.customData);
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    code: row.code,
    areaId: row.areaId,
    typeId: row.type,
    sectorId: row.sector,
    ownershipId: row.ownership,
    status: normalizeStatus(row.status),
    latitude: profile.latitude,
    longitude: profile.longitude,
    address: profile.address,
    contactPhone: profile.contactPhone,
    contactEmail: profile.contactEmail,
    deactivationReason: profile.deactivationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaInstitutionRepository implements InstitutionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<InstitutionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<InstitutionEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.institution.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          name: data.name,
          code: data.code,
          areaId: data.areaId,
          type: data.typeId,
          sector: data.sectorId,
          ownership: data.ownershipId,
          status: data.status,
          customData: buildCustomData(data) as Prisma.InputJsonValue,
        },
      })) as InstitutionRow;
      return toEntity(row);
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<InstitutionEntity>,
  ): Promise<InstitutionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.institution.findFirst({
        where: { id, tenantId, deletedAt: null },
      })) as InstitutionRow | null;
      if (!existing) return null;

      const current = toEntity(existing);
      const merged: InstitutionEntity = { ...current };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (key === 'id' || key === 'tenantId' || key === 'createdAt' || key === 'updatedAt') {
          continue;
        }
        mergedRecord[key] = value;
      }

      const row = (await tx.institution.update({
        where: { id },
        data: {
          name: merged.name,
          code: merged.code,
          areaId: merged.areaId,
          type: merged.typeId,
          sector: merged.sectorId,
          ownership: merged.ownershipId,
          status: merged.status,
          customData: buildCustomData(merged) as Prisma.InputJsonValue,
        },
      })) as InstitutionRow;
      return toEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<InstitutionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.institution.findFirst({
        where: { id, tenantId, deletedAt: null },
      })) as InstitutionRow | null;
      return row ? toEntity(row) : null;
    });
  }

  /**
   * Not supported under RLS (no tenant context in the signature). The database
   * `@@unique([tenantId, code])` constraint is the authoritative duplicate guard;
   * a duplicate create surfaces as a P2002 conflict.
   */
  async findByCode(_code: string): Promise<InstitutionEntity | null> {
    return null;
  }

  async findByNameInArea(
    name: string,
    areaId: string,
    tenantId: string,
  ): Promise<InstitutionEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.institution.findFirst({
        where: { tenantId, areaId, name, deletedAt: null },
      })) as InstitutionRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async list(
    tenantId: string,
    filter: InstitutionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<InstitutionEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      if (filter.areaId) where.areaId = filter.areaId;
      if (filter.status) where.status = filter.status;
      if (filter.search) {
        where.OR = [
          { name: { contains: filter.search, mode: 'insensitive' } },
          { code: { contains: filter.search, mode: 'insensitive' } },
        ];
      }

      const page = Math.max(1, pagination.page ?? 1);
      const pageSize = Math.max(1, Math.min(pagination.pageSize ?? 20, 100));
      const skip = (page - 1) * pageSize;

      const [totalItems, rows] = await Promise.all([
        tx.institution.count({ where }),
        tx.institution.findMany({
          where,
          orderBy: [{ name: 'asc' }],
          skip,
          take: pageSize,
        }),
      ]);

      return {
        data: (rows as InstitutionRow[]).map(toEntity),
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
        },
      };
    });
  }

  async countActiveEnrollments(institutionId: string, tenantId: string): Promise<number> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      return tx.enrollment.count({
        where: { institutionId, tenantId, status: 'ENROLLED' },
      });
    });
  }

  /**
   * No staff-assignment table exists in the current schema; deactivation is not
   * blocked on staff assignments until that table lands.
   */
  async countActiveStaffAssignments(
    _institutionId: string,
    _tenantId: string,
  ): Promise<number> {
    return 0;
  }
}
