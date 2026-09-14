/**
 * Hostel domain RBAC (W1-SEC-02 residual).
 * Wardens / registrars / admins manage occupancy, leaves, visitors, and ops.
 * Teachers / viewers / empty roles are denied (fail closed).
 */
import { AppError } from '@proctira/common';

export type HostelAction =
  | 'hostel.read'
  | 'facility.write'
  | 'assignment.manage'
  | 'leave.manage'
  | 'visitor.manage'
  | 'ops.write'
  | 'fee.manage';

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

const HOSTEL_STAFF_ROLES = [
  'warden',
  'hostel_warden',
  'hostel-warden',
  'hostel_manager',
  'hostel-manager',
  'hostel_admin',
  'hostel-admin',
  'hostel_clerk',
  'registrar',
  ...ADMIN_ROLES,
] as const;

const FEE_ROLES = [
  'bursar',
  'finance_officer',
  'accountant',
  ...HOSTEL_STAFF_ROLES,
] as const;

const ACTION_ROLES: Record<HostelAction, readonly string[]> = {
  'hostel.read': HOSTEL_STAFF_ROLES,
  'facility.write': HOSTEL_STAFF_ROLES,
  'assignment.manage': HOSTEL_STAFF_ROLES,
  'leave.manage': HOSTEL_STAFF_ROLES,
  'visitor.manage': HOSTEL_STAFF_ROLES,
  'ops.write': HOSTEL_STAFF_ROLES,
  'fee.manage': FEE_ROLES,
};

export function normalizeHostelRoles(roles: unknown): string[] {
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

export function hasHostelAccess(roles: unknown, action: HostelAction): boolean {
  const normalized = normalizeHostelRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertHostelAccess(roles: unknown, action: HostelAction): void {
  if (!hasHostelAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform hostel action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}
