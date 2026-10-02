/**
 * Staff / HR domain RBAC (production harden for ≥8.5).
 * HR officers / registrars / admins may mutate staff, contracts, leave, assignments.
 * Teachers / viewers are denied mutations (read paths stay separate).
 */
import { AppError } from '@proctira/common';

export type StaffAction =
  | 'staff.create'
  | 'staff.update'
  | 'staff.delete'
  | 'staff.hr.write'
  | 'staff.import'
  | 'payroll.export'
  // PRC-H088: HR record reads (contracts incl. monthlyGrossCents, qualifications, staff
  // attendance). These GETs previously skipped the domain guard entirely.
  | 'staff.hr.read'
  // PRC-L362: staff directory reads (GET /staff, /staff/:id, offboard status).
  | 'staff.read';

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

const HR_OFFICER_ROLES = [
  'hr_officer',
  'staff_admin',
  'registrar',
  'admissions_officer',
  'school_admin',
  ...ADMIN_ROLES,
] as const;

const ACTION_ROLES: Record<StaffAction, readonly string[]> = {
  'staff.create': HR_OFFICER_ROLES,
  'staff.update': HR_OFFICER_ROLES,
  'staff.delete': ['hr_officer', 'staff_admin', 'registrar', ...ADMIN_ROLES],
  'staff.hr.write': HR_OFFICER_ROLES,
  'staff.import': ['hr_officer', 'staff_admin', 'registrar', ...ADMIN_ROLES],
  'payroll.export': ['hr_officer', 'staff_admin', 'bursar', 'finance_officer', ...ADMIN_ROLES],
  'staff.hr.read': [...new Set<string>([...HR_OFFICER_ROLES, 'bursar', 'finance_officer'])],
  // Finance roles reconcile payroll against the staff list, but see masked identity numbers.
  'staff.read': [...new Set<string>([...HR_OFFICER_ROLES, 'bursar', 'finance_officer'])],
};

/**
 * PRC-H088: pick the HR-route action from the request path + method. Payroll is gated on every
 * method — GET /payroll/export persists (and with ?replace=true reverses) payroll runs, so it is
 * not a safe read. Other HR GETs require staff.hr.read.
 */
export function staffHrActionFor(method: string, path: string, prefix = '/staff'): StaffAction {
  const upper = method.toUpperCase();
  const isRead = upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
  const pathOnly = (path.split('?')[0] ?? path).toLowerCase();
  // Routes may be mounted under a version prefix (e.g. /api/v1), so match on path segments.
  const base = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase();
  if (new RegExp(`${base}/payroll(?:/|$)`).test(pathOnly)) return 'payroll.export';
  if (isRead) return 'staff.hr.read';
  if (new RegExp(`${base}/import(?:/|$)`).test(pathOnly)) return 'staff.import';
  return 'staff.hr.write';
}

/**
 * PRC-L362 need-to-know: only HR writers see full government identity numbers on reads.
 */
export function canViewStaffIdentity(roles: unknown): boolean {
  return hasStaffAccess(roles, 'staff.update');
}

/** Mask all but the last 4 characters of an identity number. */
export function maskIdentityNumber(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

export function normalizeStaffRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (typeof role === 'string') return role.toLowerCase();
      if (role && typeof role === 'object') {
        const obj = role as { roleId?: string; roleName?: string; id?: string };
        return String(obj.roleId ?? obj.roleName ?? obj.id ?? '').toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

export function hasStaffAccess(roles: unknown, action: StaffAction): boolean {
  const normalized = normalizeStaffRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertStaffAccess(roles: unknown, action: StaffAction): void {
  if (!hasStaffAccess(roles, action)) {
    throw new AppError(`Forbidden: role cannot perform staff action ${action}`, 'FORBIDDEN', 403);
  }
}
