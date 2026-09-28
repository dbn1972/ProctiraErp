import type { CacheClient } from '@proctira/cache';
import { tenantKey } from '@proctira/cache';
import { AppError, ErrorCode } from '@proctira/common';
import { getSharedPgPool, withPgTenant, type PgQueryable } from '@proctira/database';

export type DashboardRole = 'board' | 'principal' | 'teacher' | 'staff' | 'parent';

export interface DashboardCard {
  id: string;
  title: string;
  value: string;
  hint: string;
}

export interface RoleDashboard {
  role: DashboardRole;
  title: string;
  cards: DashboardCard[];
}

const DASHBOARDS: Record<DashboardRole, Omit<RoleDashboard, 'role'>> = {
  board: {
    title: 'Board dashboard',
    cards: [
      { id: 'board-schools', title: 'Schools', value: '—', hint: 'Institutions on this board' },
      { id: 'board-enrolment', title: 'Enrolment', value: '—', hint: 'Headcount across schools' },
      { id: 'board-fees', title: 'Fees collected', value: '—', hint: 'Succeeded payments' },
      { id: 'board-attendance', title: 'Attendance', value: '—', hint: 'Present-like share' },
    ],
  },
  principal: {
    title: 'Principal dashboard',
    cards: [
      {
        id: 'principal-attendance',
        title: 'Today attendance',
        value: '—',
        hint: 'Campus present % (today)',
      },
      {
        id: 'principal-fees-month',
        title: 'Fees collected this month',
        value: '—',
        hint: 'Succeeded payments this month',
      },
      {
        id: 'principal-admissions-pending',
        title: 'Pending admissions',
        value: '—',
        hint: 'Applications pending or under review',
      },
      {
        id: 'principal-health-incidents',
        title: 'Open health incidents',
        value: '—',
        hint: 'Nurse incidents still open',
      },
    ],
  },
  teacher: {
    title: 'Teacher dashboard',
    cards: [
      { id: 'teacher-students', title: 'Roster size', value: '—', hint: 'Students in tenant' },
      {
        id: 'teacher-attendance',
        title: 'Period attendance',
        value: '—',
        hint: 'Marked present share',
      },
      {
        id: 'teacher-enrolment',
        title: 'Active enrolments',
        value: '—',
        hint: 'Current enrolments',
      },
      { id: 'teacher-dues', title: 'Open invoices', value: '—', hint: 'Fee invoices still open' },
    ],
  },
  staff: {
    title: 'Staff dashboard',
    cards: [
      { id: 'staff-students', title: 'Students', value: '—', hint: 'Active student records' },
      {
        id: 'staff-attendance',
        title: 'Attendance',
        value: '—',
        hint: 'Campus present share',
      },
      {
        id: 'staff-enrolment',
        title: 'Active enrolments',
        value: '—',
        hint: 'Current enrolments',
      },
      { id: 'staff-notifications', title: 'Open invoices', value: '—', hint: 'Fee invoices still open' },
    ],
  },
  parent: {
    title: 'Parent dashboard',
    cards: [
      {
        id: 'parent-children',
        title: 'Linked children',
        value: '—',
        hint: 'Active guardian links',
      },
      { id: 'parent-fees', title: 'Upcoming fees', value: '—', hint: 'Open invoices' },
      { id: 'parent-students', title: 'Student records', value: '—', hint: 'Visible roster rows' },
      {
        id: 'parent-attendance',
        title: 'Child attendance',
        value: '—',
        hint: 'Present-like share',
      },
    ],
  },
};

export function buildRoleDashboard(
  role: DashboardRole,
  values: Record<string, string> = {},
): RoleDashboard {
  const spec = DASHBOARDS[role];
  return {
    role,
    title: spec.title,
    cards: spec.cards.map((c) => ({ ...c, value: values[c.id] ?? c.value })),
  };
}

export function inferDashboardRole(
  roles: Array<{ roleId?: string; roleName?: string }> | undefined,
  queryRole?: string | null,
): DashboardRole {
  const names = (roles ?? []).flatMap((r) =>
    [r.roleName, r.roleId]
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.toLowerCase()),
  );
  if (names.some((n) => n.includes('parent') || n.includes('guardian'))) return 'parent';
  if (names.some((n) => n.includes('teacher') || n.includes('faculty'))) return 'teacher';
  if (names.some((n) => n === 'staff' || n.includes('clerk') || n.includes('counsellor'))) {
    return 'staff';
  }
  if (names.some((n) => n.includes('board') || n.includes('trustee'))) return 'board';
  if (
    names.some(
      (n) =>
        n.includes('principal') ||
        n.includes('head') ||
        n.includes('admin') ||
        n.includes('super-admin'),
    )
  ) {
    return 'principal';
  }
  const requested = queryRole?.trim().toLowerCase();
  if (
    requested === 'board' ||
    requested === 'principal' ||
    requested === 'teacher' ||
    requested === 'staff' ||
    requested === 'parent'
  ) {
    return requested;
  }
  // W2-UX-04: unknown roles no longer silently become principal.
  return 'staff';
}

function parseRequestedRole(queryRole?: string | null): DashboardRole | null {
  const requested = queryRole?.trim().toLowerCase();
  if (
    requested === 'board' ||
    requested === 'principal' ||
    requested === 'teacher' ||
    requested === 'staff' ||
    requested === 'parent'
  ) {
    return requested;
  }
  return null;
}

/** Parent cannot fetch principal/board/teacher aggregates; teacher cannot fetch principal/board. */
export function resolveDashboardRole(
  roles: Array<{ roleId?: string; roleName?: string }> | undefined,
  queryRole?: string | null,
): DashboardRole {
  const actor = inferDashboardRole(roles, null);
  const requested = parseRequestedRole(queryRole);
  if (!requested || requested === actor) return requested ?? actor;
  if (actor === 'parent' && requested !== 'parent') {
    throw new AppError(
      'Parents cannot fetch principal or staff dashboard aggregates',
      ErrorCode.FORBIDDEN,
      403,
    );
  }
  if (actor === 'teacher' && (requested === 'principal' || requested === 'board')) {
    throw new AppError(
      'Teachers cannot fetch principal or board dashboard aggregates',
      ErrorCode.FORBIDDEN,
      403,
    );
  }
  if (actor === 'staff' && (requested === 'principal' || requested === 'board')) {
    throw new AppError(
      'Staff cannot fetch principal or board dashboard aggregates',
      ErrorCode.FORBIDDEN,
      403,
    );
  }
  return requested;
}

async function relationExists(client: PgQueryable, name: string): Promise<boolean> {
  try {
    const result = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
    const row = result.rows[0] as { reg?: string | null } | undefined;
    return Boolean(row?.reg);
  } catch {
    return false;
  }
}

async function count(client: PgQueryable, sql: string): Promise<number> {
  try {
    const { rows } = await client.query(sql);
    const raw = (rows[0] as { n?: unknown } | undefined)?.n;
    const n = typeof raw === 'number' ? raw : Number(raw ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export interface DashboardAggregates {
  schools: number;
  students: number;
  enrolments: number;
  attendancePercent: number | null;
  openInvoices: number;
  feesCollectedCents: number;
  linkedChildren: number;
  /** Present-share for `student_attendance` rows dated today only (server-local CURRENT_DATE). */
  todayAttendancePercent: number | null;
  /** Sum of `succeeded` `parent_fee_payments.amount_cents` paid since the start of the current month. Amount only — no target/percentage (see design §4). */
  feeCollectedThisMonthCents: number;
  /** Count of `admission_applications` rows with status `pending` or `under_review`. */
  pendingAdmissionsCount: number;
  /** Count of `health_nurse_incidents` rows with `status = 'open'`. */
  openHealthIncidentsCount: number;
}

const DEMO_AGGREGATES: DashboardAggregates = {
  schools: 3,
  students: 61,
  enrolments: 61,
  attendancePercent: 94.2,
  openInvoices: 4,
  feesCollectedCents: 1_250_000,
  linkedChildren: 2,
  todayAttendancePercent: 94.2,
  feeCollectedThisMonthCents: 420_000,
  pendingAdmissionsCount: 5,
  openHealthIncidentsCount: 2,
};

/** TTL for the cached principal dashboard aggregates (seconds). */
const AGGREGATES_TTL_SECONDS = 90;

async function computeAggregates(tenantId: string): Promise<DashboardAggregates> {
  const pool = getSharedPgPool();
  if (!pool) return { ...DEMO_AGGREGATES };
  try {
    return await withPgTenant(pool, tenantId, async (client) => {
      const schools = (await relationExists(client, 'institutions'))
        ? await count(client, `SELECT COUNT(*)::int AS n FROM institutions`)
        : 0;
      const students = (await relationExists(client, 'students'))
        ? await count(client, `SELECT COUNT(*)::int AS n FROM students WHERE deleted_at IS NULL`)
        : 0;
      const enrolments = (await relationExists(client, 'enrollments'))
        ? await count(
            client,
            `SELECT COUNT(*)::int AS n FROM enrollments WHERE status = 'ENROLLED'`,
          )
        : 0;
      let attendancePercent: number | null = null;
      let todayAttendancePercent: number | null = null;
      if (await relationExists(client, 'student_attendance')) {
        const present = await count(
          client,
          `SELECT COUNT(*)::int AS n FROM student_attendance WHERE status IN ('PRESENT','LATE','present','late')`,
        );
        const total = await count(client, `SELECT COUNT(*)::int AS n FROM student_attendance`);
        attendancePercent = total > 0 ? Math.round((present / total) * 1000) / 10 : null;

        const presentToday = await count(
          client,
          `SELECT COUNT(*)::int AS n FROM student_attendance WHERE date = CURRENT_DATE AND status IN ('PRESENT','LATE','present','late')`,
        );
        const totalToday = await count(
          client,
          `SELECT COUNT(*)::int AS n FROM student_attendance WHERE date = CURRENT_DATE`,
        );
        todayAttendancePercent =
          totalToday > 0 ? Math.round((presentToday / totalToday) * 1000) / 10 : null;
      }
      const openInvoices = (await relationExists(client, 'parent_fee_invoices'))
        ? await count(
            client,
            `SELECT COUNT(*)::int AS n FROM parent_fee_invoices WHERE status IN ('open','overdue')`,
          )
        : 0;
      let feesCollectedCents = 0;
      let feeCollectedThisMonthCents = 0;
      if (await relationExists(client, 'parent_fee_payments')) {
        feesCollectedCents = await count(
          client,
          `SELECT COALESCE(SUM(amount_cents),0)::int AS n FROM parent_fee_payments WHERE status IN ('succeeded','paid','SUCCESS')`,
        );
        feeCollectedThisMonthCents = await count(
          client,
          `SELECT COALESCE(SUM(amount_cents),0)::int AS n FROM parent_fee_payments WHERE status='succeeded' AND paid_at >= date_trunc('month', CURRENT_DATE)`,
        );
      }
      const linkedChildren = (await relationExists(client, 'parent_child_links'))
        ? await count(client, `SELECT COUNT(*)::int AS n FROM parent_child_links`)
        : students > 0
          ? Math.min(students, 2)
          : 0;
      const pendingAdmissionsCount = (await relationExists(client, 'admission_applications'))
        ? await count(
            client,
            `SELECT COUNT(*)::int AS n FROM admission_applications WHERE status IN ('pending','under_review')`,
          )
        : 0;
      const openHealthIncidentsCount = (await relationExists(client, 'health_nurse_incidents'))
        ? await count(
            client,
            `SELECT COUNT(*)::int AS n FROM health_nurse_incidents WHERE status = 'open'`,
          )
        : 0;
      if (schools + students + enrolments + openInvoices === 0 && attendancePercent == null) {
        return { ...DEMO_AGGREGATES };
      }
      return {
        schools,
        students,
        enrolments,
        attendancePercent,
        openInvoices,
        feesCollectedCents,
        linkedChildren,
        todayAttendancePercent,
        feeCollectedThisMonthCents,
        pendingAdmissionsCount,
        openHealthIncidentsCount,
      };
    });
  } catch {
    return { ...DEMO_AGGREGATES };
  }
}

/**
 * Loads the principal dashboard aggregates, optionally through a Redis
 * read-through cache. When `cache` is omitted (no `REDIS_URL` configured),
 * this runs the direct query exactly as it always has — no new required
 * dependency. When present, wraps `computeAggregates` behind a 90-second
 * tenant-scoped cache key, following the same `CacheClient.getOrSet` pattern
 * as `CachedInstitutionRepository`.
 */
export async function loadDashboardAggregates(
  tenantId: string,
  cache?: CacheClient,
): Promise<DashboardAggregates> {
  if (!cache) return computeAggregates(tenantId);
  return cache.getOrSet(
    tenantKey(tenantId, 'dashboard-aggregates', 'principal'),
    () => computeAggregates(tenantId),
    AGGREGATES_TTL_SECONDS,
  );
}

function fmtCount(n: number): string {
  return n.toLocaleString();
}

function fmtPct(n: number | null): string {
  return n == null ? '—' : `${n}%`;
}

function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

export function valuesForRole(
  role: DashboardRole,
  agg: DashboardAggregates,
): Record<string, string> {
  switch (role) {
    case 'board':
      return {
        'board-schools': fmtCount(agg.schools),
        'board-enrolment': fmtCount(agg.enrolments),
        'board-fees': fmtMoney(agg.feesCollectedCents),
        'board-attendance': fmtPct(agg.attendancePercent),
      };
    case 'principal':
      return {
        'principal-attendance': fmtPct(agg.todayAttendancePercent),
        'principal-fees-month': fmtMoney(agg.feeCollectedThisMonthCents),
        'principal-admissions-pending': fmtCount(agg.pendingAdmissionsCount),
        'principal-health-incidents': fmtCount(agg.openHealthIncidentsCount),
      };
    case 'teacher':
      return {
        'teacher-students': fmtCount(agg.students),
        'teacher-attendance': fmtPct(agg.attendancePercent),
        'teacher-enrolment': fmtCount(agg.enrolments),
        'teacher-dues': fmtCount(agg.openInvoices),
      };
    case 'staff':
      return {
        'staff-students': fmtCount(agg.students),
        'staff-attendance': fmtPct(agg.attendancePercent),
        'staff-enrolment': fmtCount(agg.enrolments),
        'staff-notifications': fmtCount(agg.openInvoices),
      };
    case 'parent':
      return {
        'parent-children': fmtCount(agg.linkedChildren),
        'parent-fees': fmtCount(agg.openInvoices),
        'parent-students': fmtCount(agg.students),
        'parent-attendance': fmtPct(agg.attendancePercent),
      };
  }
}
