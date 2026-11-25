/**
 * PRC-L034 — per-domain route authorization for staff dashboard sections.
 *
 * Defense in depth over gateway RBAC: the (dashboard) layout only checks the
 * session, so portal-only principals (student / guardian / parent) and staff
 * without the domain's read permission are stopped at the layout instead of
 * seeing empty pages backed by gateway 403s.
 */
import { CAMPUS_BASE_READ_ROLE_IDS, FEES_BASE_READ_ROLE_IDS, hasPermission } from '@proctira/auth';

import type { ServerSession } from '@/lib/auth/server';
import { sessionToAuthUser } from './examination-route-guards';
import { getWebRbacRegistry } from './web-rbac-registry';

/** Dashboard domain → gateway RBAC resource (apps/api-gateway PATH_RESOURCE_MAP). */
export const DASHBOARD_DOMAIN_RESOURCES = {
  attendance: 'attendance',
  communication: 'communication',
  'audit-logs': 'platform',
  billing: 'platform',
  'data-warehouse': 'report',
  transport: 'transport',
  hostel: 'hostel',
  'academic-periods': 'institution',
  admissions: 'registration',
  assessments: 'assessment',
  fees: 'fees',
  institutions: 'institution',
  library: 'library',
  lms: 'lms',
  pipelines: 'report',
  reports: 'report',
  scholarships: 'scholarship',
  staff: 'staff',
  students: 'student',
  'tenant-lifecycle': 'platform',
  workflows: 'workflow',
} as const;

export type DashboardDomain = keyof typeof DASHBOARD_DOMAIN_RESOURCES;

/** Roles that use the parent/student portals rather than the staff dashboard. */
export const PORTAL_ONLY_ROLE_IDS: ReadonlySet<string> = new Set(['student', 'guardian', 'parent']);

/**
 * T-D1: role ids the transport package lets through (`TRANSPORT_STAFF_ROLES`
 * in packages/backend/transport/src/transport-access.ts). The gateway only
 * serves transport data when a role holds the gateway `transport` grant AND a
 * role is in this set, so the web guard requires both. Kept in sync by
 * domain-route-guards.test.ts.
 */
export const TRANSPORT_PACKAGE_ROLE_IDS: ReadonlySet<string> = new Set([
  'transport_officer',
  'transport-officer',
  'transport_manager',
  'transport-manager',
  'fleet_manager',
  'fleet-manager',
  'transport_admin',
  'transport-admin',
  'registrar',
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
]);

/**
 * H-D1: role ids the hostel package allows `hostel.read` (`HOSTEL_STAFF_ROLES`
 * incl. `ADMIN_ROLES` in packages/backend/hostel/src/hostel-access.ts). As for
 * transport, the gateway serves hostel data only when a role holds the gateway
 * `hostel` grant AND a role is in this set. Kept in sync by
 * domain-route-guards.test.ts.
 */
export const HOSTEL_PACKAGE_ROLE_IDS: ReadonlySet<string> = new Set([
  'warden',
  'hostel_warden',
  'hostel-warden',
  'hostel_manager',
  'hostel-manager',
  'hostel_admin',
  'hostel-admin',
  'hostel_clerk',
  'registrar',
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
]);

/**
 * F-D3: role ids the fees package allows `fees.read` (`FINANCE_ROLES` incl.
 * `ADMIN_ROLES` in packages/backend/fees/src/fees-access.ts). The gateway
 * serves the staff fees screens only when a role holds the gateway `fees`
 * grant AND a role is in this set. Kept in sync by domain-route-guards.test.ts.
 */
export const FEES_PACKAGE_ROLE_IDS: ReadonlySet<string> = new Set([
  'finance_officer',
  'bursar',
  'accountant',
  'fees_clerk',
  'cashier',
  'registrar',
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
]);

/** Domains whose backend package adds its own role check after the gateway grant. */
const DOMAIN_PACKAGE_ROLE_IDS: Partial<Record<DashboardDomain, ReadonlySet<string>>> = {
  transport: TRANSPORT_PACKAGE_ROLE_IDS,
  hostel: HOSTEL_PACKAGE_ROLE_IDS,
  fees: FEES_PACKAGE_ROLE_IDS,
};

/**
 * A-batch: explicit role sets for domains where the web RBAC registry does not
 * mirror the gateway. Each set holds the gateway role catalogue roles that have
 * the gateway read grant (apps/api-gateway/src/rbac-registry.ts) AND are in the
 * backend package read set:
 * - admissions: registration-access.ts REGISTRATION_STAFF_ROLES
 * - assessments: assessment-access.ts ASSESSMENT_STAFF_ROLES
 * - communication: communication-access.ts COMMUNICATION_STAFF_ROLES
 *   (UATENV-D24: every `/communication/*` screen reads a `communication.staff`
 *   route; registrar is in the package set but holds no gateway grant)
 * - library: library-access.ts LIBRARY_STAFF_ROLES (UATENV-D20: librarian holds
 *   the gateway `library: manage` grant, packages/shared/auth rbac.ts)
 * - lms: lms-access.ts LMS_STAFF_ROLES
 * - pipelines: etl-access.ts ETL_STAFF_ROLES
 * - reports: report-access.ts staff union (admin, finance, academic, exam, registrar)
 * - scholarships: scholarship-access.ts SCHOLARSHIP_OFFICER_ROLES
 * - staff: staff-access.ts `staff.read`
 * - students: student-access.ts READ_ROLES
 * - workflows: workflow-ui-plugin.ts WORKFLOW_UI_ROLES, matched on the role id
 *   (UATENV-D25: teacher, staff and platform_admin hold the gateway `workflow`
 *   grant but the plugin refuses them)
 *
 * Fail-closed for multi-role principals: access needs one role that is in the
 * set. Fees (F-D3) left this list: it uses the package-role rule below, as
 * hostel and transport do. Sets are used instead of web registry grants
 * because that registry also drives navigation and write guards.
 * Kept in sync by domain-route-guards.test.ts.
 */
export const DOMAIN_ROUTE_ROLE_IDS: Partial<Record<DashboardDomain, ReadonlySet<string>>> = {
  admissions: new Set(['admin', 'principal', 'super-admin']),
  assessments: new Set(['admin', 'principal', 'teacher', 'super-admin']),
  communication: new Set(['admin', 'principal', 'super-admin', 'communications_officer']),
  library: new Set(['admin', 'principal', 'super-admin', 'librarian']),
  lms: new Set(['admin', 'principal', 'teacher', 'super-admin']),
  pipelines: new Set(['admin', 'principal', 'super-admin']),
  reports: new Set(['admin', 'principal', 'teacher', 'super-admin']),
  scholarships: new Set(['admin', 'principal', 'super-admin']),
  staff: new Set([
    'admin',
    'principal',
    'super-admin',
    'hr_officer',
    'staff_admin',
    'registrar',
    'admissions_officer',
  ]),
  students: new Set(['admin', 'principal', 'teacher', 'staff', 'nurse', 'super-admin']),
  workflows: new Set(['admin', 'principal', 'super-admin']),
};

/**
 * UATENV-D24/D25: nav entries (sidebar, command palette) for route-role domains
 * whose nav grant is wider than the route set. The nav shows them only to a
 * role in the domain's route set, so it does not offer a screen the route
 * guard refuses.
 */
export const ROUTE_ROLE_NAV_DOMAINS: Readonly<Record<string, DashboardDomain>> = {
  '/communication': 'communication',
  '/workflows': 'workflows',
};

/**
 * Whether the nav may show `href` to a user with these role ids. Client role
 * ids are normalised to hyphens (auth-user.ts normaliseAuthRole), so both
 * spellings are compared in hyphen form. Hrefs outside
 * {@link ROUTE_ROLE_NAV_DOMAINS} are not decided here.
 */
export function navRolesAllowHref(href: string, roleIds: readonly string[]): boolean {
  const domain = ROUTE_ROLE_NAV_DOMAINS[href];
  const routeRoles = domain ? DOMAIN_ROUTE_ROLE_IDS[domain] : undefined;
  if (!routeRoles) return true;
  const hyphen = (roleId: string) => roleId.toLowerCase().replace(/_/g, '-');
  const allowed = new Set([...routeRoles].map(hyphen));
  return roleIds.some((roleId) => allowed.has(hyphen(roleId)));
}

/**
 * A-batch: role ids for the report role dashboards (`/reports/dashboard`,
 * `/reports/dashboards`). GET /api/v1/reports/dashboard
 * (packages/backend/report/src/catalogue-routes.ts:642) does not call
 * requireReportStaff: it serves any gateway `report:read` holder. This set is
 * that grant minus portal roles and platform_admin, so office `staff` keeps
 * the staff dashboard the home page links to. The catalogue pages keep the
 * narrower `reports` set. Kept in sync by domain-route-guards.test.ts.
 */
export const REPORT_ROLE_DASHBOARD_ROLE_IDS: ReadonlySet<string> = new Set([
  'admin',
  'principal',
  'teacher',
  'staff',
  'super-admin',
]);

/**
 * UATENV-D12: the session's lower-cased role ids. A session without a roles
 * array, or a role entry without a string roleId, contributes no role, so the
 * guards deny (access-denied screen) instead of throwing (error boundary).
 */
function sessionRoleIds(session: ServerSession): string[] {
  const roles: unknown = session.user?.roles;
  if (!Array.isArray(roles)) return [];
  const ids: string[] = [];
  for (const role of roles) {
    const roleId = (role as { roleId?: unknown } | null)?.roleId;
    if (typeof roleId === 'string' && roleId) ids.push(roleId.toLowerCase());
  }
  return ids;
}

function hasStaffRole(roleIds: readonly string[]): boolean {
  return roleIds.some((roleId) => !PORTAL_ONLY_ROLE_IDS.has(roleId));
}

export function canAccessReportRoleDashboard(session: ServerSession): boolean {
  const roleIds = sessionRoleIds(session);
  return (
    hasStaffRole(roleIds) && roleIds.some((roleId) => REPORT_ROLE_DASHBOARD_ROLE_IDS.has(roleId))
  );
}

/**
 * MR-1: roles holding the gateway's plain `hostel:read` / `transport:read`
 * (gateway STAFF_READS and the student role). The packages deny them, so they
 * get no web registry grant (the nav must not show these modules to them), but
 * the gateway serves a session where one of them supplies the gateway grant
 * and another role passes the package check (e.g. teacher + school_admin).
 * F-D3: the same rule for `fees:read` (gateway STAFF_READS and the portal
 * roles). Only counted for the domains below.
 */
const CAMPUS_BASE_READERS: ReadonlySet<string> = new Set<string>(CAMPUS_BASE_READ_ROLE_IDS);
const DOMAIN_BASE_READERS: Partial<Record<DashboardDomain, ReadonlySet<string>>> = {
  hostel: CAMPUS_BASE_READERS,
  transport: CAMPUS_BASE_READERS,
  fees: new Set<string>(FEES_BASE_READ_ROLE_IDS),
};

export function canAccessDashboardDomain(session: ServerSession, domain: DashboardDomain): boolean {
  const roleIds = sessionRoleIds(session);
  if (!hasStaffRole(roleIds)) return false;
  const routeRoles = DOMAIN_ROUTE_ROLE_IDS[domain];
  if (routeRoles) {
    return roleIds.some((roleId) => routeRoles.has(roleId));
  }
  const packageRoles = DOMAIN_PACKAGE_ROLE_IDS[domain];
  if (packageRoles && !roleIds.some((roleId) => packageRoles.has(roleId))) {
    return false;
  }
  // Same multi-role rule as the gateway: some role holds the gateway grant and
  // some (possibly other) role is in the package set.
  const baseReaders = DOMAIN_BASE_READERS[domain];
  if (baseReaders && roleIds.some((roleId) => baseReaders.has(roleId))) {
    return true;
  }
  return hasPermission(
    sessionToAuthUser(session),
    DASHBOARD_DOMAIN_RESOURCES[domain],
    'read',
    getWebRbacRegistry(),
  );
}
