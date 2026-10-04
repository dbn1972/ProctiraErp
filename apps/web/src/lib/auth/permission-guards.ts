/**
 * Generic web-tier permission checks (PRC-L234 / PRC-L237).
 *
 * Defence in depth only: the gateway stays authoritative. These helpers let
 * pages and server actions fail fast (deny UI / skip the gateway call) for
 * sessions that the gateway would 403 anyway.
 */
import { hasPermission, type AuthUser, type PermissionAction } from '@proctira/auth';
import type { ServerSession } from '@/lib/auth/server';
import { getWebRbacRegistry } from './web-rbac-registry';

/**
 * JWT role ids arrive in several spellings (`SUPER_ADMIN`, `super_admin`,
 * `super-admin`). The registry uses the kebab/underscore forms from
 * `DEFAULT_ROLES` and gateway extensions, so try every spelling.
 */
function roleIdCandidates(roleId: string): string[] {
  const lower = roleId.toLowerCase();
  return Array.from(new Set([lower, lower.replace(/_/g, '-'), lower.replace(/-/g, '_')]));
}

function sessionToAuthUser(session: ServerSession): AuthUser {
  const { user } = session;
  return {
    userId: user.sub,
    tenantId: user.tenantId,
    email: user.email,
    displayName: user.displayName ?? user.email,
    roles: user.roles.flatMap((role) =>
      roleIdCandidates(role.roleId).map((roleId) => ({
        roleId,
        roleName: role.roleName,
        areaId: role.areaId,
        institutionId: role.institutionId,
      })),
    ),
    areas: [],
    institutions: [],
  };
}

/** True when any session role grants `resource:action` (or `manage`, or `*`). */
export function sessionHasPermission(
  session: ServerSession,
  resource: string,
  action: PermissionAction,
): boolean {
  return hasPermission(sessionToAuthUser(session), resource, action, getWebRbacRegistry());
}

/** Tenant administration (`/admin/*`): gateway maps it to `user:manage`. */
export function canAccessAdminRoutes(session: ServerSession): boolean {
  return sessionHasPermission(session, 'user', 'manage');
}

/** Platform surfaces (billing, audit logs, tenant lifecycle): `platform` resource. */
export function canSeePlatformSections(session: ServerSession): boolean {
  return sessionHasPermission(session, 'platform', 'read');
}
