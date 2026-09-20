/**
 * Registration / admissions domain RBAC (W1-SEC-02 residual).
 * Registrars / admissions officers / admins manage pipeline CRM and staff ops.
 * Teachers / viewers / empty roles are denied on staff actions (fail closed).
 * Public apply / tracking / school search stay ungated (no JWT roles required).
 */
import { AppError } from '@proctira/common';

export type RegistrationAction =
  | 'registration.staff.read'
  | 'registration.staff.write'
  | 'admissions.staff.read'
  | 'admissions.staff.write';

const ADMIN_ROLES = [
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
] as const;

const REGISTRATION_STAFF_ROLES = [
  'registrar',
  'admissions_officer',
  'admissions-officer',
  'admission_officer',
  'admission-officer',
  'admissions_admin',
  'admissions-admin',
  'admissions_manager',
  'admissions-manager',
  'enrollment_officer',
  'enrollment-officer',
  ...ADMIN_ROLES,
] as const;

const ACTION_ROLES: Record<RegistrationAction, readonly string[]> = {
  'registration.staff.read': REGISTRATION_STAFF_ROLES,
  'registration.staff.write': REGISTRATION_STAFF_ROLES,
  'admissions.staff.read': REGISTRATION_STAFF_ROLES,
  'admissions.staff.write': REGISTRATION_STAFF_ROLES,
};

export function normalizeRegistrationRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (typeof role === 'string') return role.toLowerCase();
      if (role && typeof role === 'object') {
        const obj = role as Record<string, unknown>;
        const raw = obj['roleId'] ?? obj['roleName'] ?? obj['id'] ?? '';
        return String(raw).toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

export function hasRegistrationAccess(
  roles: unknown,
  action: RegistrationAction,
): boolean {
  const normalized = normalizeRegistrationRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertRegistrationAccess(
  roles: unknown,
  action: RegistrationAction,
): void {
  if (!hasRegistrationAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform registration action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}

/**
 * Public registration surfaces (apply, tracking, school finder, language).
 * These must remain callable without staff roles.
 */
export function isPublicRegistrationPath(path: string): boolean {
  const bare = path.split('?')[0] ?? path;
  // Strip optional /api/v1 prefix and trailing slash noise.
  const normalized = bare.replace(/^\/api\/v1/, '').replace(/\/+$/, '') || '/';
  if (!normalized.startsWith('/registrations')) return false;
  const under = normalized.slice('/registrations'.length) || '/';

  if (under === '/' || under === '') return true;
  if (/^\/[A-Za-z0-9-]+\/status$/.test(under)) return true;
  if (under === '/institutions') return true;
  if (under.startsWith('/schools/search')) return true;
  if (under.startsWith('/form-config/')) return true;
  if (under === '/language') return true;
  return false;
}

export function registrationStaffActionForMethod(method: string): RegistrationAction {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') {
    return 'registration.staff.read';
  }
  return 'registration.staff.write';
}

export function admissionsStaffActionForMethod(method: string): RegistrationAction {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') {
    return 'admissions.staff.read';
  }
  return 'admissions.staff.write';
}
