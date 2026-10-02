/**
 * Campus RBAC role definitions shared by the API gateway and the web BFF
 * (PRC-L237).
 *
 * This is the single source of truth for DEFAULT_ROLES plus the campus /
 * portal / platform extensions. `apps/api-gateway` enforces with it and
 * `apps/web` gates UI with it, so the two can no longer drift. Moved verbatim
 * from `apps/api-gateway/src/rbac-registry.ts` (behaviour-preserving; the
 * gateway parity test pins the exact role table).
 */
import { DEFAULT_ROLES, RbacPermissionRegistry } from './rbac.js';
import type { Permission, PermissionAction, RoleDefinition } from './rbac.js';

/** Campus domain resources not fully covered by shared DEFAULT_ROLES. */
export const CAMPUS_MANAGE_RESOURCES = [
  'health',
  'scholarship',
  'lms',
  'fees',
  'parent',
  'timetable',
  'gradebook',
  'curriculum',
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
  'student-portal',
] as const;

export const CAMPUS_MANAGE: Permission[] = CAMPUS_MANAGE_RESOURCES.map((resource) => ({
  resource,
  action: 'manage' as const,
}));

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

function cloneRoles(roles: RoleDefinition[]): RoleDefinition[] {
  return roles.map((role) => ({
    ...role,
    permissions: role.permissions.map((p) => ({ ...p })),
  }));
}

/**
 * Role table: DEFAULT_ROLES extended with campus resources for
 * admin/principal/teacher/staff/guardian, HR roles, nurse, parent, student and
 * platform_admin. Returns fresh objects on every call.
 */
export function createCampusRoleDefinitions(): RoleDefinition[] {
  const roles = cloneRoles(DEFAULT_ROLES);

  const admin = roles.find((r) => r.roleId === 'admin');
  if (admin) {
    // PRC-L004: the tenant administrator owns its school/board branding (preview + edit).
    admin.permissions.push({ resource: 'branding', action: 'manage' });
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
      { resource: 'curriculum', action: 'create' },
      { resource: 'curriculum', action: 'read' },
      { resource: 'curriculum', action: 'update' },
      { resource: 'curriculum', action: 'list' },
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
      { resource: 'report', action: 'read' },
      { resource: 'library', action: 'read' },
    );
  }

  // W1-SEC-02 (D4): HR / registrar roles — gateway must align with
  // `@proctira/backend-staff` staff-access HR_OFFICER_ROLES (not only admin/principal).
  const STAFF_HR_PERMISSIONS: Permission[] = [{ resource: 'staff', action: 'manage' }];
  for (const roleId of ['hr_officer', 'staff_admin', 'registrar', 'admissions_officer'] as const) {
    roles.push({
      roleId,
      roleName: roleId
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' '),
      permissions: STAFF_HR_PERMISSIONS.map((p) => ({ ...p })),
    });
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
      { resource: 'gradebook', action: 'read' },
      { resource: 'timetable', action: 'read' },
      { resource: 'report', action: 'read' },
      { resource: 'library', action: 'read' },
    ],
  });

  roles.push({
    roleId: 'student',
    roleName: 'Student',
    permissions: [
      ...PORTAL_SELF_SERVICE_WRITES,
      { resource: 'parent', action: 'read' },
      { resource: 'parent', action: 'list' },
      { resource: 'student-portal', action: 'read' },
      { resource: 'student-portal', action: 'list' },
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

  return roles;
}

/** Permission registry over {@link createCampusRoleDefinitions}. */
export function createCampusRbacRegistry(): RbacPermissionRegistry {
  return new RbacPermissionRegistry(createCampusRoleDefinitions());
}
