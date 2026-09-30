/**
 * PRC-C008: role gate for the staff-facing fee routes mounted under the parent-portal plugin.
 *
 * These routes (fee-plan create/list, invoice create/void, tenant-wide invoice/payment/receipt
 * lists, staff-scope receipt reads) manage or expose tenant-wide fee data and must be restricted
 * to finance/admin staff. They previously had no domain role check, so any guardian/student —
 * the normal audience of the parent-portal plugin — could call them (directly, or via
 * ?scope=staff) and read every invoice/payment/receipt in the tenant.
 *
 * Role names mirror the fees package (FINANCE_ROLES + admin) so the two packages agree.
 */
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

const FEES_STAFF_ROLES = new Set<string>([
  'finance_officer',
  'bursar',
  'accountant',
  'fees_clerk',
  'cashier',
  'registrar',
  ...ADMIN_ROLES,
]);

export function normalizeParentPortalRoles(roles: unknown): string[] {
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

/** True when the caller holds a finance/admin role permitted to manage tenant fee data. */
export function isFeesStaff(roles: unknown): boolean {
  const normalized = normalizeParentPortalRoles(roles);
  return normalized.some((role) => FEES_STAFF_ROLES.has(role));
}
