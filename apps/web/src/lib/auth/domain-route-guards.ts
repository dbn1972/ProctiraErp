/**
 * PRC-L034 — per-domain route authorization for staff dashboard sections.
 *
 * Defense in depth over gateway RBAC: the (dashboard) layout only checks the
 * session, so portal-only principals (student / guardian / parent) and staff
 * without the domain's read permission are stopped at the layout instead of
 * seeing empty pages backed by gateway 403s.
 */
import { CAMPUS_BASE_READ_ROLE_IDS, hasPermission } from '@proctira/auth';

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

/** Domains whose backend package adds its own role check after the gateway grant. */
const DOMAIN_PACKAGE_ROLE_IDS: Partial<Record<DashboardDomain, ReadonlySet<string>>> = {
  transport: TRANSPORT_PACKAGE_ROLE_IDS,
  hostel: HOSTEL_PACKAGE_ROLE_IDS,
};

function hasStaffRole(session: ServerSession): boolean {
  return session.user.roles.some((role) => !PORTAL_ONLY_ROLE_IDS.has(role.roleId.toLowerCase()));
}

/**
 * MR-1: roles holding the gateway's plain `hostel:read` / `transport:read`
 * (gateway STAFF_READS and the student role). The packages deny them, so they
 * get no web registry grant (the nav must not show these modules to them), but
 * the gateway serves a session where one of them supplies the gateway grant
 * and another role passes the package check (e.g. teacher + school_admin).
 * Only counted for the domains below.
 */
const CAMPUS_BASE_READERS: ReadonlySet<string> = new Set<string>(CAMPUS_BASE_READ_ROLE_IDS);
const BASE_READ_DOMAINS: ReadonlySet<DashboardDomain> = new Set<DashboardDomain>([
  'hostel',
  'transport',
]);

export function canAccessDashboardDomain(session: ServerSession, domain: DashboardDomain): boolean {
  if (!hasStaffRole(session)) return false;
  const packageRoles = DOMAIN_PACKAGE_ROLE_IDS[domain];
  if (
    packageRoles &&
    !session.user.roles.some((role) => packageRoles.has(role.roleId.toLowerCase()))
  ) {
    return false;
  }
  // Same multi-role rule as the gateway: some role holds the gateway grant and
  // some (possibly other) role is in the package set.
  if (
    BASE_READ_DOMAINS.has(domain) &&
    session.user.roles.some((role) => CAMPUS_BASE_READERS.has(role.roleId.toLowerCase()))
  ) {
    return true;
  }
  return hasPermission(
    sessionToAuthUser(session),
    DASHBOARD_DOMAIN_RESOURCES[domain],
    'read',
    getWebRbacRegistry(),
  );
}
