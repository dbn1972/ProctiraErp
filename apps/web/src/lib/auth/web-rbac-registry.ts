/**
 * Web-side RBAC registry aligned with gateway campus extensions (G-101).
 *
 * Scope is intentionally minimal: only the examination.read grants that the
 * gateway adds beyond {@link DEFAULT_ROLES}, so UI route guards match API
 * deny-matrix behaviour without importing the api-gateway package.
 */
import {
  DEFAULT_ROLES,
  RbacPermissionRegistry,
  type Permission,
  type RoleDefinition,
} from '@proctira/auth';

const EXAMINATION_READ: Permission = { resource: 'examination', action: 'read' };

/** Gateway STAFF_READS + student examination.read (rbac-registry.ts). */
const EXAMINATION_READ_ROLE_IDS = ['teacher', 'staff', 'student'] as const;

function cloneRoles(roles: RoleDefinition[]): RoleDefinition[] {
  return roles.map((role) => ({
    ...role,
    permissions: [...role.permissions],
  }));
}

function roleGrantsExamination(role: RoleDefinition): boolean {
  return role.permissions.some(
    (permission) =>
      permission.resource === 'examination' &&
      (permission.action === 'read' || permission.action === 'manage'),
  );
}

export function createWebRbacRegistry(): RbacPermissionRegistry {
  const roles = cloneRoles(DEFAULT_ROLES);

  for (const roleId of EXAMINATION_READ_ROLE_IDS) {
    const role = roles.find((entry) => entry.roleId === roleId);
    if (role && !roleGrantsExamination(role)) {
      role.permissions.push(EXAMINATION_READ);
    }
  }

  return new RbacPermissionRegistry(roles);
}

let cachedRegistry: RbacPermissionRegistry | undefined;

export function getWebRbacRegistry(): RbacPermissionRegistry {
  cachedRegistry ??= createWebRbacRegistry();
  return cachedRegistry;
}

/** Test-only: reset memoized registry between cases. */
export function resetWebRbacRegistryCache(): void {
  cachedRegistry = undefined;
}
