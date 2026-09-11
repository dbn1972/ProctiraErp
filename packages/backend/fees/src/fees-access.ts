/**
 * Fees RBAC helpers (PRD-005).
 * Finance / bursar roles may post payments; teachers/viewers are denied.
 */
import { AppError } from '@proctira/common';

export type FeesAction = 'payment.record' | 'invoice.void' | 'refund.record';

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

const FINANCE_ROLES = [
  'finance_officer',
  'bursar',
  'accountant',
  'fees_clerk',
  'cashier',
  'parent',
  'guardian',
  ...ADMIN_ROLES,
] as const;

const ACTION_ROLES: Record<FeesAction, readonly string[]> = {
  'payment.record': FINANCE_ROLES,
  'invoice.void': ['finance_officer', 'bursar', 'accountant', ...ADMIN_ROLES],
  'refund.record': ['finance_officer', 'bursar', 'accountant', ...ADMIN_ROLES],
};

export function normalizeFeesRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => {
      if (typeof r === 'string') return r.toLowerCase();
      if (r && typeof r === 'object') {
        const obj = r as { roleId?: string; roleName?: string; id?: string };
        return String(obj.roleId ?? obj.roleName ?? obj.id ?? '').toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

export function hasFeesAccess(roles: unknown, action: FeesAction): boolean {
  const normalized = normalizeFeesRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertFeesAccess(roles: unknown, action: FeesAction): void {
  if (!hasFeesAccess(roles, action)) {
    throw new AppError(`Forbidden: role cannot perform fees action ${action}`, 'FORBIDDEN', 403);
  }
}
