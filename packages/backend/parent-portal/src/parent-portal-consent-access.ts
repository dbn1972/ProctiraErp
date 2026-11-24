/**
 * PRC-H073: role gate for consent create/supersede in the parent-portal plugin.
 *
 * Consent requests (medical/data-sharing/etc.) are raised BY staff FOR a linked guardian to
 * decide — they are not something a guardian creates for themselves or supersedes on another
 * family. The create/supersede handlers previously had no role or ownership check, so any
 * authenticated user could forge a consent request naming any parent+student, or close another
 * parent's consent. These operations must be restricted to staff, with the (parent, student)
 * link verified in the service.
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

const CONSENT_STAFF_ROLES = new Set<string>([
  'registrar',
  'admissions_officer',
  'student_affairs',
  'nurse',
  'counselor',
  'counsellor',
  'data_protection_officer',
  'dpo',
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

/** True when the caller holds a staff role permitted to raise/supersede consent requests. */
export function isConsentStaff(roles: unknown): boolean {
  return normalizeParentPortalRoles(roles).some((r) => CONSENT_STAFF_ROLES.has(r));
}
