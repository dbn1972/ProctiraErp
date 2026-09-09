/**
 * Gateway RBAC registry — DEFAULT_ROLES plus campus/platform extensions (G-101).
 */

import type { Permission, PermissionAction, RoleDefinition } from '@proctira/backend-auth';
import { DEFAULT_ROLES, RbacPermissionRegistry } from '@proctira/backend-auth';

/** Campus domain resources not fully covered by shared DEFAULT_ROLES. */
const CAMPUS_MANAGE_RESOURCES = [
  'health',
  'scholarship',
  'lms',
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
  'report',
  'workflow',
  'assessment',
  'student',
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
  lms: 'lms',
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
  // G-701 / G-702: native prefixes served by mounted packages
  enrollments: 'student',
  'grading-schemes': 'assessment',
  'assessment-items': 'assessment',
  outcomes: 'assessment',
  results: 'assessment',
  'report-cards': 'assessment',
  // G-901: institution academics sub-domains mounted by institutionPlugin
  'academic-periods': 'institution',
  grades: 'institution',
  classes: 'institution',
  subjects: 'institution',
  'institution-subjects': 'institution',
  infrastructure: 'institution',
  reports: 'report',
  'data-warehouse': 'report',
  'workflow-engine': 'workflow',
  // G-910: tenant admin console (roles / users / settings) — tenant `admin`
  // holds `user: manage`, so no platform-admin rights needed.
  tenant: 'user',
  // G-924: SCIM 2.0 provisioning writes the same tenant directory.
  scim: 'user',
  // Platform control plane (billing / tenant lifecycle / audit log API)
  billing: 'platform',
  'tenant-lifecycle': 'platform',
  'audit-logs': 'platform',
  admin: 'platform',
  // Platform-admin console
  tenants: 'platform',
  plans: 'platform',
  'break-glass': 'platform',
  platform: 'platform',
  audit: 'platform',
  plugins: 'platform',
  themes: 'platform',
};

/**
 * G-702: `/api/v1/<segment>` paths outside `/auth` that are NOT in
 * {@link PATH_RESOURCE_MAP} are denied for every non-platform-admin caller.
 * Adding a mounted prefix therefore requires an explicit RBAC mapping.
 * The gateway test `gateway-mount-matrix.test.ts` enforces that every mounted
 * prefix appears here.
 */
export const UNMAPPED_API_RESOURCE = '__unmapped__';

/** Paths under /api/v1 that are gateway-owned utilities, not domain resources. */
export const GATEWAY_UTILITY_SEGMENTS = new Set(['services', 'storage']);

/**
 * G-712: resources any authenticated principal may READ (own-scope filtering
 * happens in the domain plugin) — notifications and the parent/student portal.
 */
export const SELF_SERVICE_READ_RESOURCES = new Set(['notification', 'parent']);

/**
 * Portal self-service writes: parents/guardians/students act on their own
 * links, message threads, consent decisions and fee payments. The gateway
 * grants the verb; `@proctira/backend-parent-portal` binds every row to the
 * JWT `sub` (G-306) so no cross-actor write is possible.
 */
export const PORTAL_SELF_SERVICE_WRITES: ReadonlyArray<{
  resource: string;
  action: PermissionAction;
}> = [
  { resource: 'parent', action: 'create' },
  { resource: 'parent', action: 'update' },
  { resource: 'parent', action: 'delete' },
];

export const PLATFORM_PATH_SEGMENTS = new Set([
  'tenants',
  'plans',
  'break-glass',
  'platform',
  'audit',
  'plugins',
  'themes',
  'billing',
  'tenant-lifecycle',
  'audit-logs',
  'admin',
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
 * Returns undefined when the path is outside /api/v1, is auth, or a gateway
 * utility; returns {@link UNMAPPED_API_RESOURCE} for unknown segments so the
 * gateway can default-deny (G-702).
 */
export function resourceForApiPath(pathname: string): string | undefined {
  const path = pathname.split('?')[0] ?? pathname;
  if (!path.startsWith('/api/v1/')) return undefined;
  if (path.startsWith('/api/v1/auth/') || path === '/api/v1/auth') return undefined;

  const rest = path.slice('/api/v1/'.length);
  const segment = rest.split('/').filter(Boolean)[0];
  if (!segment) return undefined;
  if (GATEWAY_UTILITY_SEGMENTS.has(segment)) return undefined;
  return PATH_RESOURCE_MAP[segment] ?? UNMAPPED_API_RESOURCE;
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

  // Principal runs one institution: campus manage minus platform (G-712 reads).
  const principal = roles.find((r) => r.roleId === 'principal');
  if (principal) {
    for (const perm of CAMPUS_MANAGE) {
      if (
        !principal.permissions.some((p) => p.resource === perm.resource && p.action === perm.action)
      ) {
        principal.permissions.push(perm);
      }
    }
  }

  // Campus reads shared by every school-staff role (G-712 GET enforcement).
  const STAFF_READS: Permission[] = [
    { resource: 'timetable', action: 'read' },
    { resource: 'timetable', action: 'list' },
    { resource: 'communication', action: 'read' },
    { resource: 'library', action: 'read' },
    { resource: 'hostel', action: 'read' },
    { resource: 'transport', action: 'read' },
    { resource: 'examination', action: 'read' },
    { resource: 'report', action: 'read' },
    { resource: 'workflow', action: 'read' },
    { resource: 'fees', action: 'read' },
    { resource: 'scholarship', action: 'read' },
    { resource: 'registration', action: 'read' },
  ];

  const teacher = roles.find((r) => r.roleId === 'teacher');
  if (teacher) {
    const teacherExtras: Permission[] = [
      ...STAFF_READS,
      { resource: 'gradebook', action: 'create' },
      { resource: 'gradebook', action: 'read' },
      { resource: 'gradebook', action: 'update' },
      { resource: 'gradebook', action: 'list' },
      { resource: 'health', action: 'read' },
      { resource: 'workflow', action: 'create' },
      { resource: 'workflow', action: 'update' },
      // G-801: teachers author school-scoped assignments / homework / quizzes and grade.
      { resource: 'lms', action: 'create' },
      { resource: 'lms', action: 'read' },
      { resource: 'lms', action: 'update' },
      { resource: 'lms', action: 'delete' },
      { resource: 'lms', action: 'list' },
    ];
    teacher.permissions.push(...teacherExtras);
  }

  const staffRole = roles.find((r) => r.roleId === 'staff');
  if (staffRole) {
    staffRole.permissions.push(
      ...STAFF_READS,
      { resource: 'gradebook', action: 'read' },
      { resource: 'lms', action: 'read' },
    );
  }

  const guardian = roles.find((r) => r.roleId === 'guardian');
  if (guardian) {
    guardian.permissions.push(
      ...PORTAL_SELF_SERVICE_WRITES,
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
      ...PORTAL_SELF_SERVICE_WRITES,
      { resource: 'parent', action: 'read' },
      { resource: 'parent', action: 'list' },
      { resource: 'student', action: 'read' },
      { resource: 'attendance', action: 'read' },
      { resource: 'assessment', action: 'read' },
      { resource: 'health', action: 'read' },
      { resource: 'fees', action: 'read' },
      { resource: 'communication', action: 'read' },
      { resource: 'lms', action: 'read' },
    ],
  });

  roles.push({
    roleId: 'student',
    roleName: 'Student',
    permissions: [
      ...PORTAL_SELF_SERVICE_WRITES,
      { resource: 'parent', action: 'read' },
      { resource: 'parent', action: 'list' },
      { resource: 'student', action: 'read' },
      { resource: 'attendance', action: 'read' },
      { resource: 'assessment', action: 'read' },
      { resource: 'gradebook', action: 'read' },
      { resource: 'timetable', action: 'read' },
      { resource: 'examination', action: 'read' },
      { resource: 'fees', action: 'read' },
      { resource: 'library', action: 'read' },
      { resource: 'hostel', action: 'read' },
      { resource: 'transport', action: 'read' },
      { resource: 'communication', action: 'read' },
      { resource: 'scholarship', action: 'read' },
      // G-801/G-802: learners read published work, submit, and practise;
      // `@proctira/backend-lms` binds every write to the JWT `sub`.
      { resource: 'lms', action: 'read' },
      { resource: 'lms', action: 'create' },
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
