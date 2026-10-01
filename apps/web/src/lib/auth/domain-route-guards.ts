/**
 * PRC-L034 — per-domain route authorization for staff dashboard sections.
 *
 * Defense in depth over gateway RBAC: the (dashboard) layout only checks the
 * session, so portal-only principals (student / guardian / parent) and staff
 * without the domain's read permission are stopped at the layout instead of
 * seeing empty pages backed by gateway 403s.
 */
import { hasPermission } from '@proctira/auth';

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
} as const;

export type DashboardDomain = keyof typeof DASHBOARD_DOMAIN_RESOURCES;

/** Roles that use the parent/student portals rather than the staff dashboard. */
export const PORTAL_ONLY_ROLE_IDS: ReadonlySet<string> = new Set(['student', 'guardian', 'parent']);

function hasStaffRole(session: ServerSession): boolean {
  return session.user.roles.some((role) => !PORTAL_ONLY_ROLE_IDS.has(role.roleId.toLowerCase()));
}

export function canAccessDashboardDomain(session: ServerSession, domain: DashboardDomain): boolean {
  if (!hasStaffRole(session)) return false;
  return hasPermission(
    sessionToAuthUser(session),
    DASHBOARD_DOMAIN_RESOURCES[domain],
    'read',
    getWebRbacRegistry(),
  );
}
