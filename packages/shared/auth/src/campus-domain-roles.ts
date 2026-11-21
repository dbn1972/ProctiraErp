/**
 * Hostel and transport staff grants shared by the gateway and web RBAC
 * registries (H-D2, T-O1, H-D1-R5).
 *
 * The hostel and transport packages (`hostel-access.ts`, `transport-access.ts`)
 * let these roles through, but the gateway registry granted them nothing, so
 * only admin and principal could use either module. Both
 * `createGatewayRbacRegistry()` (apps/api-gateway) and
 * `createWebRbacRegistry()` (apps/web) apply this one matrix, so the gateway
 * and the web route guards cannot drift.
 *
 * Least privilege:
 * - hostel staff: hostel read, list, create, update (the hostel API has no
 *   DELETE routes);
 * - transport staff: transport read, list, create, update, delete (the
 *   package's `transport.write` covers the stop / assignment DELETE routes);
 * - registrar (a records role): read and list on both, no writes.
 * No role gets `manage`, `*`, or any other resource. The package guards still
 * run after the gateway grant, and every query stays scoped to the JWT tenant.
 */
import type { Permission, PermissionAction, RoleDefinition } from './rbac.js';

/** Hostel package staff roles (both spellings, as `hostel-access.ts` lists them). */
export const HOSTEL_STAFF_ROLE_IDS = [
  'warden',
  'hostel_warden',
  'hostel-warden',
  'hostel_manager',
  'hostel-manager',
  'hostel_admin',
  'hostel-admin',
  'hostel_clerk',
] as const;

/** Transport package staff roles (both spellings, as `transport-access.ts` lists them). */
export const TRANSPORT_STAFF_ROLE_IDS = [
  'transport_officer',
  'transport-officer',
  'transport_manager',
  'transport-manager',
  'fleet_manager',
  'fleet-manager',
  'transport_admin',
  'transport-admin',
] as const;

/** Roles that may read, but not write, hostel and transport. */
export const CAMPUS_READ_ONLY_ROLE_IDS = ['registrar'] as const;

/**
 * Built-in roles that hold the gateway's plain `hostel:read` and
 * `transport:read` (gateway STAFF_READS for teacher/staff, the student role).
 * The hostel and transport packages deny them, so they are not given a web
 * grant (the nav must not show the modules to them); the web route guard
 * counts them as holding the gateway read only for the multi-role rule (MR-1).
 * Pinned against the gateway registry by apps/api-gateway rbac-campus-roles.test.ts.
 */
export const CAMPUS_BASE_READ_ROLE_IDS = ['teacher', 'staff', 'student'] as const;

export interface CampusDomainRoleGrant {
  roleId: string;
  roleName: string;
  permissions: readonly Permission[];
}

const HOSTEL_STAFF_ACTIONS: readonly PermissionAction[] = ['read', 'list', 'create', 'update'];
const TRANSPORT_STAFF_ACTIONS: readonly PermissionAction[] = [
  'read',
  'list',
  'create',
  'update',
  'delete',
];
const READ_ONLY_ACTIONS: readonly PermissionAction[] = ['read', 'list'];

function permissions(resource: string, actions: readonly PermissionAction[]): Permission[] {
  return actions.map((action) => ({ resource, action }));
}

function displayName(roleId: string): string {
  return roleId
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** The grant matrix, one entry per role id. */
export const CAMPUS_DOMAIN_ROLE_GRANTS: readonly CampusDomainRoleGrant[] = [
  ...HOSTEL_STAFF_ROLE_IDS.map((roleId) => ({
    roleId,
    roleName: displayName(roleId),
    permissions: permissions('hostel', HOSTEL_STAFF_ACTIONS),
  })),
  ...TRANSPORT_STAFF_ROLE_IDS.map((roleId) => ({
    roleId,
    roleName: displayName(roleId),
    permissions: permissions('transport', TRANSPORT_STAFF_ACTIONS),
  })),
  ...CAMPUS_READ_ONLY_ROLE_IDS.map((roleId) => ({
    roleId,
    roleName: displayName(roleId),
    permissions: [
      ...permissions('hostel', READ_ONLY_ACTIONS),
      ...permissions('transport', READ_ONLY_ACTIONS),
    ],
  })),
];

/**
 * Adds the campus grants to `roles` in place and returns it. An existing role
 * (for example the gateway's `registrar` with `staff:manage`) keeps its
 * permissions and gains the missing grants; an absent role is added.
 * Idempotent; permission objects are copied, never shared.
 */
export function applyCampusDomainRoleGrants(roles: RoleDefinition[]): RoleDefinition[] {
  for (const grant of CAMPUS_DOMAIN_ROLE_GRANTS) {
    const existing = roles.find((role) => role.roleId === grant.roleId);
    if (!existing) {
      roles.push({
        roleId: grant.roleId,
        roleName: grant.roleName,
        permissions: grant.permissions.map((p) => ({ ...p })),
      });
      continue;
    }
    for (const permission of grant.permissions) {
      if (
        !existing.permissions.some(
          (p) => p.resource === permission.resource && p.action === permission.action,
        )
      ) {
        existing.permissions.push({ ...permission });
      }
    }
  }
  return roles;
}
