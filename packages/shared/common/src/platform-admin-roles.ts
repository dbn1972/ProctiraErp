/**
 * Canonical platform-admin role ids (G-104). The API gateway gates the platform
 * admin console with this set, and domain packages that make platform-scope
 * decisions (e.g. the theme package's global platform theme, PRC-M395) must use
 * the same set so a package mounted behind the gateway cannot widen who counts
 * as a platform admin.
 *
 * Matching is exact on the role id: no case-folding and no fallback to a
 * tenant-editable display name.
 */
export const PLATFORM_ADMIN_ROLE_IDS: ReadonlySet<string> = new Set([
  'platform_admin',
  'super-admin',
]);

/**
 * True when any of the principal's roles is a platform-admin role id. Accepts
 * string role ids or `{ roleId }` records (the gateway JWT shapes); objects
 * without a string `roleId` never match.
 */
export function hasPlatformAdminRole(roles: unknown): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((role: unknown) => {
    if (typeof role === 'string') return PLATFORM_ADMIN_ROLE_IDS.has(role);
    if (role && typeof role === 'object') {
      const roleId = (role as { roleId?: unknown }).roleId;
      return typeof roleId === 'string' && PLATFORM_ADMIN_ROLE_IDS.has(roleId);
    }
    return false;
  });
}
