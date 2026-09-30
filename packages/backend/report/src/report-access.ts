/**
 * PRC-C009: role/entitlement gate for the report catalogue.
 *
 * The catalogue generates and serves tenant-wide PII/financial artifacts (students roster,
 * fee dues, exam results, attendance, enrolment). The gateway grants `report:read` to
 * parent/guardian/student as well as staff, and the catalogue routes had no domain check — so
 * any of those roles could generate, list, and download the whole school's data.
 *
 * This module restricts the catalogue to staff, applies a per-report entitlement map so a
 * report is only produced for roles that legitimately need it, and identifies report-managers
 * (admins) who may see other users' runs/artifacts.
 */
import type { CatalogueReportKey } from './catalogue.js';

const ADMIN_ROLES = new Set<string>([
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
]);

const FINANCE_ROLES = new Set<string>([
  'finance_officer',
  'bursar',
  'accountant',
  'fees_clerk',
  'cashier',
]);

const ACADEMIC_STAFF_ROLES = new Set<string>([
  'teacher',
  'class_teacher',
  'subject_teacher',
  'hod',
  'academic_coordinator',
]);

const EXAM_STAFF_ROLES = new Set<string>([
  'examinations_officer',
  'exam_officer',
  'board_officer',
]);

const REGISTRAR_ROLES = new Set<string>(['registrar', 'admissions_officer', 'staff_admin']);

/** Portal roles that must never reach the staff report catalogue. */
const PORTAL_ROLES = new Set<string>(['parent', 'guardian', 'student']);

/**
 * Per-report entitlement: which role groups may generate/read each report. Admins may read all.
 * Every report is tenant-wide, so only staff who own the domain are entitled.
 */
const REPORT_ENTITLEMENTS: Record<CatalogueReportKey, ReadonlySet<string>> = {
  students_roster: union(REGISTRAR_ROLES, ACADEMIC_STAFF_ROLES),
  attendance_summary: union(REGISTRAR_ROLES, ACADEMIC_STAFF_ROLES),
  enrolment_by_grade: union(REGISTRAR_ROLES, ACADEMIC_STAFF_ROLES),
  fee_dues: FINANCE_ROLES,
  exam_results: union(EXAM_STAFF_ROLES, REGISTRAR_ROLES),
};

function union(...sets: ReadonlySet<string>[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
}

export function normalizeReportRoles(
  roles: ReadonlyArray<{ roleId?: string; roleName?: string; id?: string } | string> | undefined,
): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r: { roleId?: string; roleName?: string; id?: string } | string) => {
      if (typeof r === 'string') return r.toLowerCase();
      return String(r.roleId ?? r.roleName ?? r.id ?? '').toLowerCase();
    })
    .filter(Boolean);
}

/** Any recognised staff role (admin or a domain staff role). */
export function isReportStaff(roles: Parameters<typeof normalizeReportRoles>[0]): boolean {
  const names = normalizeReportRoles(roles);
  return names.some(
    (r) =>
      ADMIN_ROLES.has(r) ||
      FINANCE_ROLES.has(r) ||
      ACADEMIC_STAFF_ROLES.has(r) ||
      EXAM_STAFF_ROLES.has(r) ||
      REGISTRAR_ROLES.has(r),
  );
}

/** Report managers (admins) may read every report and other users' runs/artifacts. */
export function isReportManager(roles: Parameters<typeof normalizeReportRoles>[0]): boolean {
  return normalizeReportRoles(roles).some((r) => ADMIN_ROLES.has(r));
}

/** True when at least one of the caller's roles is a portal role. */
export function hasPortalRole(roles: Parameters<typeof normalizeReportRoles>[0]): boolean {
  return normalizeReportRoles(roles).some((r) => PORTAL_ROLES.has(r));
}

/**
 * Whether the caller may generate/read a specific report. Admins: all. Others: must hold a role
 * in that report's entitlement set. Portal roles are always denied.
 */
export function canAccessReport(
  roles: Parameters<typeof normalizeReportRoles>[0],
  reportKey: CatalogueReportKey,
): boolean {
  if (hasPortalRole(roles) && !isReportStaff(roles)) return false;
  if (isReportManager(roles)) return true;
  const names = normalizeReportRoles(roles);
  const allowed = REPORT_ENTITLEMENTS[reportKey];
  return names.some((r) => allowed.has(r));
}
