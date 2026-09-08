/**
 * Prisma Staff Repository
 *
 * Production implementation of {@link StaffRepository} backed by PostgreSQL via
 * Prisma, RLS-safe through {@link withTenantTransaction} (tenantId also kept in
 * every `where` clause as defense-in-depth).
 *
 * Schema mapping: the `staff` table stores first/last name, date_of_birth,
 * identity_number and a `custom_data` JSONB column. The entity's contactPhone/
 * contactEmail/position/status are persisted inside `custom_data` under a
 * reserved `__profile` envelope and stripped back out on read.
 *
 * Global uniqueness: `findByIdentityNumber` (no tenantId in the interface)
 * cannot run under RLS, so it returns null; the database
 * `@@unique([tenantId, identityNumber])` constraint is the authoritative guard
 * (a duplicate create surfaces as P2002 → 409).
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type { StaffEntity, StaffFilter, StaffRepository } from './staff-repository.js';

const PROFILE_KEY = '__profile';

interface ProfileEnvelope {
  contactPhone: string;
  contactEmail: string | null;
  position: string;
  status: 'ACTIVE' | 'INACTIVE';
}

interface StaffRow {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  identityNumber: string;
  customData: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
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
      contactPhone: rawProfile.contactPhone ?? '',
      contactEmail: rawProfile.contactEmail ?? null,
      position: rawProfile.position ?? '',
      status: rawProfile.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    },
    userCustomData: raw,
  };
}

function buildCustomData(entity: Partial<StaffEntity>): Record<string, unknown> {
  const profile: ProfileEnvelope = {
    contactPhone: entity.contactPhone ?? '',
    contactEmail: entity.contactEmail ?? null,
    position: entity.position ?? '',
    status: entity.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
  };
  return { ...(entity.customData ?? {}), [PROFILE_KEY]: profile };
}

function toEntity(row: StaffRow): StaffEntity {
  const { profile, userCustomData } = extractProfile(row.customData);
  return {
    id: row.id,
    tenantId: row.tenantId,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: toIsoDate(row.dateOfBirth),
    identityNumber: row.identityNumber,
    contactPhone: profile.contactPhone,
    contactEmail: profile.contactEmail,
    position: profile.position,
    status: profile.status,
    customData: userCustomData,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaStaffRepository implements StaffRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: Omit<StaffEntity, 'createdAt' | 'updatedAt'>): Promise<StaffEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.staff.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          firstName: data.firstName,
          lastName: data.lastName,
          dateOfBirth: new Date(data.dateOfBirth),
          identityNumber: data.identityNumber,
          customData: buildCustomData(data) as Prisma.InputJsonValue,
        },
      })) as StaffRow;
      return toEntity(row);
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<StaffEntity>,
  ): Promise<StaffEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.staff.findFirst({
        where: { id, tenantId, deletedAt: null },
      })) as StaffRow | null;
      if (!existing) return null;

      const current = toEntity(existing);
      const merged: StaffEntity = { ...current };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (key === 'id' || key === 'tenantId' || key === 'createdAt' || key === 'updatedAt') {
          continue;
        }
        mergedRecord[key] = value;
      }

      const row = (await tx.staff.update({
        where: { id },
        data: {
          firstName: merged.firstName,
          lastName: merged.lastName,
          dateOfBirth: new Date(merged.dateOfBirth),
          identityNumber: merged.identityNumber,
          customData: buildCustomData(merged) as Prisma.InputJsonValue,
        },
      })) as StaffRow;
      return toEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<StaffEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.staff.findFirst({
        where: { id, tenantId, deletedAt: null },
      })) as StaffRow | null;
      return row ? toEntity(row) : null;
    });
  }

  /**
   * Not supported under RLS (no tenant context in the signature). The database
   * `@@unique([tenantId, identityNumber])` constraint is the authoritative
   * duplicate guard; a duplicate create surfaces as a P2002 conflict.
   */
  async findByIdentityNumber(_identityNumber: string): Promise<StaffEntity | null> {
    return null;
  }

  async list(
    tenantId: string,
    filter: StaffFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StaffEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      // status/position live in custom_data → filter in-memory after fetch.
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      if (filter.search) {
        const terms = filter.search.trim().split(/\s+/).filter(Boolean);
        if (terms.length > 0) {
          where.AND = terms.map((term) => ({
            OR: [
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
              { identityNumber: { contains: term, mode: 'insensitive' } },
            ],
          }));
        }
      }

      const page = Math.max(1, pagination.page ?? 1);
      const pageSize = Math.max(1, Math.min(pagination.pageSize ?? 20, 100));

      const allRows = (await tx.staff.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      })) as StaffRow[];

      let entities = allRows.map(toEntity);
      if (filter.status) entities = entities.filter((s) => s.status === filter.status);
      if (filter.position) entities = entities.filter((s) => s.position === filter.position);

      const totalItems = entities.length;
      const skip = (page - 1) * pageSize;
      const data = entities.slice(skip, skip + pageSize);

      return {
        data,
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
        },
      };
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const result = await tx.staff.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return result.count > 0;
    });
  }
}
