/**
 * Gateway RBAC registry — DEFAULT_ROLES plus campus/platform extensions (G-101).
 */

import type { Permission, PermissionAction, RoleDefinition } from '@proctira/backend-auth';
import { DEFAULT_ROLES, RbacPermissionRegistry } from '@proctira/backend-auth';

/** Campus domain resources not fully covered by shared DEFAULT_ROLES. */
const CAMPUS_MANAGE_RESOURCES = [
  'health',
  'scholarship',
  'fees',
  'parent',
  'timetable',
  'gradebook',
  'hostel',
  'transport',
  'library',
  'communication',
  'notification',
  'registration',
  'developer',
] as const;

const CAMPUS_MANAGE: Permission[] = CAMPUS_MANAGE_RESOURCES.map((resource) => ({
  resource,
  action: 'manage' as const,
}));

/**
 * URL path segment (first under /api/v1) → RBAC resource name.
 * Platform console paths map to the synthetic `platform` resource.
 */
export const PATH_RESOURCE_MAP: Record<string, string> = {
  students: 'student',
  institutions: 'institution',
  staff: 'staff',
  attendance: 'attendance',
  examinations: 'examination',
  assessments: 'assessment',
  timetable: 'timetable',
  gradebook: 'gradebook',
  scholarships: 'scholarship',
  health: 'health',
  workflows: 'workflow',
  notifications: 'notification',
  transport: 'transport',
  communication: 'communication',
  hostel: 'hostel',
  library: 'library',
  'parent-portal': 'parent',
  registrations: 'registration',
  fees: 'fees',
  developer: 'developer',
  // Platform-admin console
  tenants: 'platform',
  plans: 'platform',
  'break-glass': 'platform',
  platform: 'platform',
  audit: 'platform',
  plugins: 'platform',
  themes: 'platform',
};

export const PLATFORM_PATH_SEGMENTS = new Set([
  'tenants',
  'plans',
  'break-glass',
  'platform',
  'audit',
  'plugins',
  'themes',
]);

/** Role IDs that may access the platform admin console (G-104). */
export const PLATFORM_ADMIN_ROLE_IDS = new Set(['platform_admin', 'super-admin']);

/** Map HTTP method → PermissionAction. */
export function actionForMethod(method: string): PermissionAction {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'read';
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'read';
  }
}

/**
 * Resolve RBAC resource from a request URL path under /api/v1.
 * Returns undefined when the path is outside /api/v1, is auth, or unmapped.
 */
export function resourceForApiPath(pathname: string): string | undefined {
  const path = pathname.split('?')[0] ?? pathname;
  if (!path.startsWith('/api/v1/')) return undefined;
  if (path.startsWith('/api/v1/auth/') || path === '/api/v1/auth') return undefined;

  const rest = path.slice('/api/v1/'.length);
  const segment = rest.split('/').filter(Boolean)[0];
  if (!segment) return undefined;
  return PATH_RESOURCE_MAP[segment];
}

function cloneRoles(roles: RoleDefinition[]): RoleDefinition[] {
  return roles.map((role) => ({
    ...role,
    permissions: role.permissions.map((p) => ({ ...p })),
  }));
}

/**
 * Build the gateway permission registry from DEFAULT_ROLES, extending campus
 * resources for admin/teacher/nurse/parent and adding platform_admin.
 */
export function createGatewayRbacRegistry(): RbacPermissionRegistry {
  const roles = cloneRoles(DEFAULT_ROLES);

  const admin = roles.find((r) => r.roleId === 'admin');
  if (admin) {
    for (const perm of CAMPUS_MANAGE) {
      if (
        !admin.permissions.some((p) => p.resource === perm.resource && p.action === perm.action)
      ) {
        admin.permissions.push(perm);
      }
    }
  }

  const teacher = roles.find((r) => r.roleId === 'teacher');
  if (teacher) {
    const teacherExtras: Permission[] = [
      { resource: 'timetable', action: 'read' },
      { resource: 'timetable', action: 'list' },
      { resource: 'gradebook', action: 'create' },
      { resource: 'gradebook', action: 'read' },
      { resource: 'gradebook', action: 'update' },
      { resource: 'gradebook', action: 'list' },
      { resource: 'communication', action: 'read' },
      { resource: 'library', action: 'read' },
      { resource: 'health', action: 'read' },
    ];
    teacher.permissions.push(...teacherExtras);
  }

  const guardian = roles.find((r) => r.roleId === 'guardian');
  if (guardian) {
    guardian.permissions.push(
      { resource: 'parent', action: 'read' },
      { resource: 'parent', action: 'list' },
      { resource: 'fees', action: 'read' },
    );
  }

  roles.push({
    roleId: 'nurse',
    roleName: 'Nurse',
    permissions: [
      { resource: 'health', action: 'manage' },
      { resource: 'student', action: 'read' },
      { resource: 'student', action: 'list' },
      { resource: 'parent', action: 'read' },
    ],
  });

  roles.push({
    roleId: 'parent',
    roleName: 'Parent',
    permissions: [
      { resource: 'parent', action: 'read' },
      { resource: 'parent', action: 'list' },
      { resource: 'student', action: 'read' },
      { resource: 'attendance', action: 'read' },
      { resource: 'assessment', action: 'read' },
      { resource: 'health', action: 'read' },
      { resource: 'fees', action: 'read' },
      { resource: 'communication', action: 'read' },
    ],
  });

  roles.push({
    roleId: 'platform_admin',
    roleName: 'Platform Administrator',
    permissions: [
      { resource: 'platform', action: 'manage' },
      { resource: '*', action: 'manage' },
    ],
  });

  return new RbacPermissionRegistry(roles);
}
