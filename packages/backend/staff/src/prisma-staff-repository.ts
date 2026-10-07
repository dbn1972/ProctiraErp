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

import type {
  StaffEntity,
  StaffFilter,
  StaffRepository,
  StaffTransactionScope,
} from './staff-repository.js';
import { matchesStaffType } from './staff-type.js';

const PROFILE_KEY = '__profile';

/** PRC-L157: static allowlist of tables holding per-staff HR/payroll history. */
const STAFF_DEPENDENT_TABLES: ReadonlyArray<readonly [kind: string, table: string]> = [
  ['payrollLines', 'staff_payroll_lines'],
  ['contracts', 'staff_contracts'],
  ['attendance', 'staff_hr_attendance'],
  ['leaveRequests', 'staff_leave_requests'],
  ['appraisals', 'hr_appraisals'],
  ['trainingAttendance', 'hr_training_attendance'],
  ['certifications', 'hr_certifications'],
];

/**
 * Literal COUNT statement per dependent table (PRC-L157). Spelled out rather than
 * interpolated so the no-runtime-DDL gate (PRC-L386) can prove every raw statement
 * reaching `$queryRawUnsafe` is static DML.
 */
function dependentCountSql(table: string): string {
  switch (table) {
    case 'staff_payroll_lines':
      return 'SELECT COUNT(*)::int AS n FROM staff_payroll_lines WHERE tenant_id = $1::uuid AND staff_id = $2::uuid';
    case 'staff_contracts':
      return 'SELECT COUNT(*)::int AS n FROM staff_contracts WHERE tenant_id = $1::uuid AND staff_id = $2::uuid';
    case 'staff_hr_attendance':
      return 'SELECT COUNT(*)::int AS n FROM staff_hr_attendance WHERE tenant_id = $1::uuid AND staff_id = $2::uuid';
    case 'staff_leave_requests':
      return 'SELECT COUNT(*)::int AS n FROM staff_leave_requests WHERE tenant_id = $1::uuid AND staff_id = $2::uuid';
    case 'hr_appraisals':
      return 'SELECT COUNT(*)::int AS n FROM hr_appraisals WHERE tenant_id = $1::uuid AND staff_id = $2::uuid';
    case 'hr_training_attendance':
      return 'SELECT COUNT(*)::int AS n FROM hr_training_attendance WHERE tenant_id = $1::uuid AND staff_id = $2::uuid';
    case 'hr_certifications':
      return 'SELECT COUNT(*)::int AS n FROM hr_certifications WHERE tenant_id = $1::uuid AND staff_id = $2::uuid';
    default:
      throw new Error(`No dependent-count statement for table ${table}`);
  }
}

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

type StaffTx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];

async function createStaffRow(
  tx: StaffTx,
  data: Omit<StaffEntity, 'createdAt' | 'updatedAt'>,
): Promise<StaffEntity> {
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
}

/** Interactive-transaction limits for {@link PrismaStaffRepository.withTransaction}. */
const STAFF_TX_MAX_WAIT_MS = 10_000;
const STAFF_TX_TIMEOUT_MS = 120_000;

export class PrismaStaffRepository implements StaffRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async withTransaction<T>(
    tenantId: string,
    fn: (scope: StaffTransactionScope) => Promise<T>,
  ): Promise<T> {
    return withTenantTransaction(
      this.prisma,
      tenantId,
      async (tx) => {
        const scope: StaffTransactionScope = {
          create: async (data) => {
            if (data.tenantId !== tenantId) {
              throw new Error('Staff transaction scope is bound to a different tenant');
            }
            return createStaffRow(tx, data);
          },
          executor: {
            // Allowlisted in check-no-runtime-ddl (DYNAMIC_SQL_ALLOWLIST): callers pass static,
            // parameterised DML (pg-hr-ops-store insertContract).
            query: async (text, values = []) => ({
              rows: await tx.$queryRawUnsafe<unknown[]>(text, ...values),
            }),
          },
        };
        return fn(scope);
      },
      // allOrNothing imports hold one interactive transaction across every row; Prisma's 5s
      // default would roll back large files with P2028.
      { maxWait: STAFF_TX_MAX_WAIT_MS, timeout: STAFF_TX_TIMEOUT_MS },
    );
  }
  async create(data: Omit<StaffEntity, 'createdAt' | 'updatedAt'>): Promise<StaffEntity> {
    return withTenantTransaction(this.prisma, data.tenantId, async (tx) =>
      createStaffRow(tx, data),
    );
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
      if (filter.ids) where.id = { in: [...filter.ids] };
      // PRC-H090: school-scope. institutionId must actually restrict the result
      // set, resolving staff → institution via staff_assignments. Without this
      // the gateway's institution-scope filter was silently dropped and a
      // school-bound HR user saw every school's staff.
      if (filter.institutionId) {
        const assignments = (await tx.staffAssignment.findMany({
          where: { tenantId, institutionId: filter.institutionId },
          select: { staffId: true },
        })) as Array<{ staffId: string }>;
        const scopedIds = Array.from(new Set(assignments.map((a) => a.staffId)));
        if (filter.ids) {
          // Intersect with any pre-existing id filter.
          const allowed = new Set(scopedIds);
          where.id = { in: [...filter.ids].filter((id) => allowed.has(id)) };
        } else {
          where.id = { in: scopedIds };
        }
      }
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
      if (filter.staffType) {
        const type = filter.staffType;
        entities = entities.filter((s) => matchesStaffType(s.position, type));
      }

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

  /** PRC-H090: institution ids this staff member is assigned to. */
  async findInstitutionIds(tenantId: string, staffId: string): Promise<string[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.staffAssignment.findMany({
        where: { tenantId, staffId },
        select: { institutionId: true },
      })) as Array<{ institutionId: string }>;
      return Array.from(new Set(rows.map((r) => r.institutionId)));
    });
  }

  /**
   * PRC-L157: counts rows referencing the staff member in HR/payroll tables. Table names come
   * from a static allowlist; tables absent in this deployment are skipped via to_regclass so
   * the check never aborts the transaction.
   */
  async countDependents(id: string, tenantId: string): Promise<Record<string, number>> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const counts: Record<string, number> = {};
      for (const [kind, table] of STAFF_DEPENDENT_TABLES) {
        const exists = await tx.$queryRawUnsafe<{ present: boolean }[]>(
          `SELECT to_regclass($1) IS NOT NULL AS present`,
          `public.${table}`,
        );
        if (!exists[0]?.present) continue;
        const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
          dependentCountSql(table),
          tenantId,
          id,
        );
        counts[kind] = Number(rows[0]?.n ?? 0);
      }
      return counts;
    });
  }

  async findExistingIds(ids: readonly string[], tenantId: string): Promise<string[]> {
    if (ids.length === 0) return [];
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.staff.findMany({
        where: { id: { in: [...ids] }, tenantId, deletedAt: null },
        select: { id: true },
      })) as { id: string }[];
      return rows.map((r) => r.id);
    });
  }

  async listAfterId(
    tenantId: string,
    afterId: string | null,
    limit: number,
  ): Promise<StaffEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Record<string, unknown> = { tenantId, deletedAt: null };
      if (afterId) where.id = { gt: afterId };
      const rows = (await tx.staff.findMany({
        where,
        orderBy: { id: 'asc' },
        take: Math.max(1, Math.min(limit, 1000)),
      })) as StaffRow[];
      return rows.map(toEntity);
    });
  }
  async purgeCreated(id: string, tenantId: string): Promise<void> {
    await withTenantTransaction(this.prisma, tenantId, async (tx) => {
      await tx.staff.deleteMany({ where: { id, tenantId } });
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
