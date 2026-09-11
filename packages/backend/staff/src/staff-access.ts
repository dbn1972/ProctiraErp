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
  | 'payroll.export';

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
};

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
