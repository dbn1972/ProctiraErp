/**
 * Web-side RBAC registry aligned with gateway campus extensions (G-101).
 *
 * Scope is intentionally minimal: only the examination.read grants that the
 * gateway adds beyond {@link DEFAULT_ROLES}, so UI route guards match API
 * deny-matrix behaviour without importing the api-gateway package.
 */
import {
  applyCampusDomainRoleGrants,
  applyFeesDomainRoleGrants,
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
  admin: [
    { resource: 'communication', action: 'manage' },
    // PRC-M480: gateway CAMPUS_MANAGE subset behind dashboard write-route guards.
    { resource: 'lms', action: 'manage' },
    { resource: 'library', action: 'manage' },
    // T-D1: gateway CAMPUS_MANAGE. The gateway's teacher/staff transport.read
    // (STAFF_READS) is not mirrored: the transport package denies those roles.
    { resource: 'transport', action: 'manage' },
    // H-D1: gateway CAMPUS_MANAGE. The gateway's teacher/staff/student
    // hostel.read is not mirrored: the hostel package denies those roles.
    { resource: 'hostel', action: 'manage' },
  ],
  principal: [
    { resource: 'communication', action: 'manage' },
    { resource: 'report', action: 'manage' },
    { resource: 'lms', action: 'manage' },
    { resource: 'library', action: 'manage' },
    { resource: 'transport', action: 'manage' },
    { resource: 'hostel', action: 'manage' },
  ],
  teacher: [
    { resource: 'communication', action: 'read' },
    { resource: 'report', action: 'read' },
    // G-801 (gateway): teachers author and grade LMS work.
    { resource: 'lms', action: 'create' },
    { resource: 'lms', action: 'read' },
    { resource: 'lms', action: 'update' },
    { resource: 'lms', action: 'delete' },
    { resource: 'lms', action: 'list' },
    { resource: 'library', action: 'read' },
  ],
  staff: [
    { resource: 'communication', action: 'read' },
    { resource: 'report', action: 'read' },
    { resource: 'lms', action: 'read' },
    { resource: 'library', action: 'read' },
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
  // H-D2 / T-O1 / H-D1-R5: the same hostel/transport staff matrix the gateway
  // registry applies (one source in @proctira/auth, so the two cannot drift).
  applyCampusDomainRoleGrants(roles);
  // F-D3: the same finance-role fees matrix the gateway registry applies.
  applyFeesDomainRoleGrants(roles);
  // PRC-L234: mirror the gateway's platform_admin role (platform + '*' manage)
  // so platform surfaces are only advertised to callers the gateway serves.
  if (!roles.some((role) => role.roleId === 'platform_admin')) {
    roles.push({
      roleId: 'platform_admin',
      roleName: 'Platform Administrator',
      permissions: [
        { resource: 'platform', action: 'manage' },
        { resource: '*', action: 'manage' },
      ],
    });
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
