/**
 * Prisma Student Repository
 *
 * Production implementation of {@link StudentRepository} backed by PostgreSQL
 * via Prisma. Every method runs inside {@link withTenantTransaction} so that the
 * `app.current_tenant_id` RLS variable is bound on the same connection that
 * executes the query — without this, Row-Level Security would return zero rows
 * (see the helper's docs for why). `tenantId` is also kept in every `where`
 * clause as defense-in-depth, so isolation holds even if RLS is ever disabled.
 *
 * Schema note: the Prisma `students` table does not (yet) have columns for
 * `nationality`, `contacts`, `guardians`, or `identityDocuments`. To satisfy the
 * full {@link StudentEntity} contract without a schema migration, those fields are
 * persisted inside the existing `custom_data` JSONB column under a reserved
 * `__profile` envelope, and stripped back out on read so callers never see it
 * mixed into their own custom data. The production-grade alternative is dedicated
 * columns/child tables (Phase 1 of the wiring plan); this keeps the repository
 * self-contained and fully functional in the meantime.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  StudentContact,
  StudentEntity,
  StudentFilter,
  StudentGuardian,
  IdentityDocument,
  StudentRepository,
} from './student-repository.js';

/** Reserved key under `custom_data` that holds structured profile fields. */
const PROFILE_KEY = '__profile';

/** Scalar columns that may be used for `ORDER BY` in list queries. */
const SORTABLE_COLUMNS = new Set([
  'firstName',
  'lastName',
  'dateOfBirth',
  'gender',
  'nationalId',
  'createdAt',
  'updatedAt',
]);

interface ProfileEnvelope {
  nationality: string | null;
  contacts: StudentContact[];
  guardians: StudentGuardian[];
  identityDocuments: IdentityDocument[];
}

/** Minimal shape of a `students` row this repository reads back. */
interface StudentRow {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender: string;
  nationalId: string | null;
  customData: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function toIsoDate(value: Date): string {
  // `date_of_birth` is a date-only column; normalize to YYYY-MM-DD.
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
      nationality: rawProfile.nationality ?? null,
      contacts: rawProfile.contacts ?? [],
      guardians: rawProfile.guardians ?? [],
      identityDocuments: rawProfile.identityDocuments ?? [],
    },
    userCustomData: raw,
  };
}

function buildCustomData(entity: {
  customData?: Record<string, unknown>;
  nationality?: string | null;
  contacts?: StudentContact[];
  guardians?: StudentGuardian[];
  identityDocuments?: IdentityDocument[];
}): Record<string, unknown> {
  const profile: ProfileEnvelope = {
    nationality: entity.nationality ?? null,
    contacts: entity.contacts ?? [],
    guardians: entity.guardians ?? [],
    identityDocuments: entity.identityDocuments ?? [],
  };
  return { ...(entity.customData ?? {}), [PROFILE_KEY]: profile };
}

function toEntity(row: StudentRow): StudentEntity {
  const { profile, userCustomData } = extractProfile(row.customData);
  return {
    id: row.id,
    tenantId: row.tenantId,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: toIsoDate(row.dateOfBirth),
    gender: row.gender,
    nationalId: row.nationalId ?? null,
    nationality: profile.nationality,
    contacts: profile.contacts,
    guardians: profile.guardians,
    identityDocuments: profile.identityDocuments,
    customData: userCustomData,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaStudentRepository implements StudentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<StudentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StudentEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) => {
      const row = (await tx.student.create({
        data: {
          id: data.id,
          tenantId: data.tenantId,
          firstName: data.firstName,
          lastName: data.lastName,
          dateOfBirth: new Date(data.dateOfBirth),
          gender: data.gender,
          nationalId: data.nationalId,
          customData: buildCustomData(data) as Prisma.InputJsonValue,
        },
      })) as StudentRow;
      return toEntity(row);
    });
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<StudentEntity>,
  ): Promise<StudentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existingRow = (await tx.student.findFirst({
        where: { id, tenantId, deletedAt: null },
      })) as StudentRow | null;
      if (!existingRow) {
        return null;
      }

      // Merge the partial update over the current entity, ignoring immutable
      // fields and any explicit `undefined` so callers can omit untouched keys.
      const current = toEntity(existingRow);
      const merged: StudentEntity = { ...current };
      const mergedRecord = merged as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        if (key === 'id' || key === 'tenantId' || key === 'createdAt' || key === 'updatedAt') {
          continue;
        }
        mergedRecord[key] = value;
      }

      const row = (await tx.student.update({
        where: { id },
        data: {
          firstName: merged.firstName,
          lastName: merged.lastName,
          dateOfBirth: new Date(merged.dateOfBirth),
          gender: merged.gender,
          nationalId: merged.nationalId,
          customData: buildCustomData(merged) as Prisma.InputJsonValue,
        },
      })) as StudentRow;
      return toEntity(row);
    });
  }

  async findById(id: string, tenantId: string): Promise<StudentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.student.findFirst({
        where: { id, tenantId, deletedAt: null },
      })) as StudentRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async findByNationalId(
    nationalId: string,
    tenantId: string,
  ): Promise<StudentEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.student.findFirst({
        where: { nationalId, tenantId, deletedAt: null },
      })) as StudentRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async list(
    tenantId: string,
    filter: StudentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = buildListWhere(tenantId, filter);
      const orderBy = buildOrderBy(pagination);
      const { skip, take } = buildPageWindow(pagination);

      const [totalItems, rows] = await Promise.all([
        tx.student.count({ where }),
        tx.student.findMany({ where, orderBy, skip, take }),
      ]);

      return toPage(rows as StudentRow[], totalItems, pagination);
    });
  }

  async search(
    tenantId: string,
    query: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentEntity>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where = buildSearchWhere(tenantId, query);
      const { skip, take } = buildPageWindow(pagination);

      const [totalItems, rows] = await Promise.all([
        tx.student.count({ where }),
        tx.student.findMany({
          where,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          skip,
          take,
        }),
      ]);

      return toPage(rows as StudentRow[], totalItems, pagination);
    });
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      // Soft delete: only rows that exist within the tenant and aren't already
      // deleted are affected. `count` tells us whether anything changed.
      const result = await tx.student.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return result.count > 0;
    });
  }
}

// ---------------------------------------------------------------------------
// Query builders (pure helpers — no DB access, easy to unit test in isolation)
// ---------------------------------------------------------------------------

function buildListWhere(
  tenantId: string,
  filter: StudentFilter,
): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId, deletedAt: null };
  if (filter.gender) {
    where.gender = filter.gender;
  }
  if (filter.search) {
    where.OR = nameOrNationalIdMatch(filter.search);
  }
  return where;
}

function buildSearchWhere(
  tenantId: string,
  query: string,
): Record<string, unknown> {
  // Each whitespace-separated term must match the first name, last name, or
  // national id (case-insensitive). This makes "John Smith" match a student
  // named John Smith, while a single term still does a broad contains match.
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return { tenantId, deletedAt: null };
  }
  return {
    tenantId,
    deletedAt: null,
    AND: terms.map((term) => ({ OR: nameOrNationalIdMatch(term) })),
  };
}

function nameOrNationalIdMatch(term: string): Array<Record<string, unknown>> {
  const contains = { contains: term, mode: 'insensitive' as const };
  return [
    { firstName: contains },
    { lastName: contains },
    { nationalId: contains },
  ];
}

function buildOrderBy(
  pagination: PaginationOptions,
): Record<string, 'asc' | 'desc'> {
  const sortBy =
    pagination.sortBy && SORTABLE_COLUMNS.has(pagination.sortBy)
      ? pagination.sortBy
      : 'lastName';
  const sortOrder = pagination.sortOrder ?? 'asc';
  return { [sortBy]: sortOrder };
}

function buildPageWindow(pagination: PaginationOptions): {
  skip: number;
  take: number;
} {
  return {
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
  };
}

function toPage(
  rows: StudentRow[],
  totalItems: number,
  pagination: PaginationOptions,
): PaginatedResult<StudentEntity> {
  return {
    data: rows.map(toEntity),
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pagination.pageSize),
    },
  };
}
