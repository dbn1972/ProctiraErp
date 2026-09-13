/**
 * Fees RBAC helpers (W1-SEC-02 D1 / PRD-005).
 * Finance / bursar roles manage tenant fee ledgers; teachers/viewers are denied.
 * Parents/guardians may pay and read own-scope invoices only.
 */
import { AppError } from '@proctira/common';

export type FeesAction =
  | 'fees.read'
  | 'fees.read.self'
  | 'fees.write'
  | 'payment.record'
  | 'invoice.void'
  | 'refund.record'
  | 'concession.apply'
  | 'reconciliation.import'
  | 'reminder.manage';

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
  'registrar',
  ...ADMIN_ROLES,
] as const;

const SELF_READ_ROLES = ['parent', 'guardian', 'student'] as const;

const SELF_PAY_ROLES = ['parent', 'guardian'] as const;

const ACTION_ROLES: Record<FeesAction, readonly string[]> = {
  'fees.read': FINANCE_ROLES,
  'fees.read.self': [...SELF_READ_ROLES, ...FINANCE_ROLES],
  'fees.write': FINANCE_ROLES,
  'payment.record': [...SELF_PAY_ROLES, ...FINANCE_ROLES],
  'invoice.void': ['finance_officer', 'bursar', 'accountant', ...ADMIN_ROLES],
  'refund.record': ['finance_officer', 'bursar', 'accountant', ...ADMIN_ROLES],
  'concession.apply': ['finance_officer', 'bursar', 'accountant', 'principal', ...ADMIN_ROLES],
  'reconciliation.import': ['finance_officer', 'bursar', 'accountant', ...ADMIN_ROLES],
  'reminder.manage': FINANCE_ROLES,
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
