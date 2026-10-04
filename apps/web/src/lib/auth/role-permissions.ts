/**
 * Derives UI permission strings (`resource.action`) from session role ids
 * (PRC-H028).
 *
 * Session JWTs carry roles but no permission claims, so `AuthUser.permissions`
 * used to be `[]` and the sidebar / command palette hid Attendance, Students
 * and Assessments from teachers. This expands roles through the web RBAC
 * registry (DEFAULT_ROLES + gateway extensions) plus the backend domain role
 * sets that are not in DEFAULT_ROLES (e.g. attendance-access.ts).
 *
 * This is navigation UX only — the gateway / domain services remain the
 * authorization check for every request.
 */
import { getWebRbacRegistry } from './web-rbac-registry';

/** Resources a wildcard (`*`) grant expands to for navigation purposes. */
const NAV_RESOURCES = [
  'institution',
  'student',
  'staff',
  'assessment',
  'attendance',
  'examination',
  'lms',
  'scholarship',
  'health',
  'workflow',
  'data-warehouse',
  'analytics',
  'etl',
  'report',
  'settings',
  'fees',
  'transport',
  'hostel',
  'library',
  'communication',
] as const;

const ADMIN_ROLES = [
  'admin',
  'super-admin',
  'system-admin',
  'administrator',
  'principal',
  'school-admin',
] as const;

/**
 * Role grants not expressed in DEFAULT_ROLES. Mirrors backend role sets
 * (attendance-access.ts ATTENDANCE_WRITE_ROLES: teacher, class_teacher,
 * attendance_officer, registrar) and gives campus modules explicit owners
 * instead of showing them to every staff user.
 */
const SUPPLEMENTAL_GRANTS: Record<string, readonly string[]> = {
  teacher: ['examination.read', 'communication.read'],
  'class-teacher': [
    'institution.read',
    'student.read',
    'assessment.read',
    'attendance.read',
    'attendance.create',
    'attendance.update',
    'examination.read',
    'communication.read',
  ],
  'attendance-officer': ['student.read', 'attendance.read', 'attendance.approve'],
  registrar: ['student.read', 'attendance.read', 'attendance.approve'],
  staff: ['communication.read'],
  accountant: ['fees.read'],
  bursar: ['fees.read'],
  'fees-officer': ['fees.read'],
  'finance-officer': ['fees.read'],
  librarian: ['library.read'],
  'transport-manager': ['transport.read'],
  'transport-officer': ['transport.read'],
  warden: ['hostel.read'],
  'hostel-warden': ['hostel.read'],
};

const ADMIN_CAMPUS_GRANTS = [
  'fees.read',
  'transport.read',
  'hostel.read',
  'library.read',
  'communication.read',
] as const;

function normaliseRole(role: string): string {
  return role.toLowerCase().replace(/_/g, '-').trim();
}

/** Returns the sorted, de-duplicated permission strings granted by `roles`. */
export function permissionsForRoles(roles: readonly string[]): string[] {
  const registry = getWebRbacRegistry();
  const out = new Set<string>();

  for (const raw of roles) {
    const roleId = normaliseRole(raw);
    if (!roleId) continue;

    const definition = registry.getRole(roleId);
    for (const permission of definition?.permissions ?? []) {
      const resources = permission.resource === '*' ? NAV_RESOURCES : [permission.resource];
      for (const resource of resources) {
        out.add(`${resource}.${permission.action}`);
        // `manage` implies read; `list` is a read for navigation purposes.
        if (permission.action === 'manage' || permission.action === 'list') {
          out.add(`${resource}.read`);
        }
      }
    }

    for (const grant of SUPPLEMENTAL_GRANTS[roleId] ?? []) out.add(grant);
    if ((ADMIN_ROLES as readonly string[]).includes(roleId)) {
      for (const grant of ADMIN_CAMPUS_GRANTS) out.add(grant);
    }
  }

  return [...out].sort();
}
