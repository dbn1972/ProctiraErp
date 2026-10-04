/**
 * Session-level permission checks for UI affordances (PRC-L052).
 *
 * Uses the same web RBAC registry as the examination route guards. This only
 * decides what to *show*; the gateway still authorizes every request.
 */
import { hasPermission, type AuthUser, type PermissionAction } from '@proctira/auth';
import type { TokenPayload } from './session';
import { getWebRbacRegistry } from './web-rbac-registry';

type SessionUser = Pick<TokenPayload, 'sub' | 'tenantId' | 'email' | 'displayName' | 'roles'>;

function toAuthUser(user: SessionUser): AuthUser {
  return {
    userId: user.sub,
    tenantId: user.tenantId,
    email: user.email,
    displayName: user.displayName ?? user.email,
    roles: (user.roles ?? []).map((role) => ({
      roleId: role.roleId.toLowerCase(),
      roleName: role.roleName,
      areaId: role.areaId,
      institutionId: role.institutionId,
    })),
    areas: [],
    institutions: [],
  };
}

export function sessionUserHasPermission(
  user: SessionUser | null | undefined,
  resource: string,
  action: PermissionAction,
): boolean {
  if (!user) return false;
  return hasPermission(toAuthUser(user), resource, action, getWebRbacRegistry());
}
