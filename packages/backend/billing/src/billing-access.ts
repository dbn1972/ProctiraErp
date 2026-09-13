/**
 * Billing / platform subscription RBAC (W1-SEC-02 D1).
 * SaaS control-plane routes require platform administrator roles only.
 */
import { AppError } from '@proctira/common';

export type BillingAction = 'billing.read' | 'billing.manage';

const PLATFORM_ADMIN_ROLES = [
  'platform_admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
] as const;

const ACTION_ROLES: Record<BillingAction, readonly string[]> = {
  'billing.read': PLATFORM_ADMIN_ROLES,
  'billing.manage': PLATFORM_ADMIN_ROLES,
};

export function normalizeBillingRoles(roles: unknown): string[] {
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

export function hasBillingAccess(roles: unknown, action: BillingAction): boolean {
  const normalized = normalizeBillingRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertBillingAccess(roles: unknown, action: BillingAction): void {
  if (!hasBillingAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform billing action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}
