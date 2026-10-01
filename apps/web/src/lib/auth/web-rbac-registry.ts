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

/** Gateway CAMPUS_MANAGE / STAFF_READS subset used by dashboard domain guards. */
const DOMAIN_GRANTS: Record<string, Permission[]> = {
  admin: [{ resource: 'communication', action: 'manage' }],
  principal: [
    { resource: 'communication', action: 'manage' },
    { resource: 'report', action: 'manage' },
  ],
  teacher: [
    { resource: 'communication', action: 'read' },
    { resource: 'report', action: 'read' },
  ],
  staff: [
    { resource: 'communication', action: 'read' },
    { resource: 'report', action: 'read' },
  ],
};

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

  // PRC-L034: dashboard domain guards (communication / data-warehouse→report /
  // platform) mirror the gateway grants in apps/api-gateway/src/rbac-registry.ts.
  for (const [roleId, extras] of Object.entries(DOMAIN_GRANTS)) {
    const role = roles.find((entry) => entry.roleId === roleId);
    if (role) role.permissions.push(...extras);
  }
  roles.push({
    roleId: 'platform_admin',
    roleName: 'Platform Administrator',
    permissions: [{ resource: 'platform', action: 'manage' }],
  });

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
