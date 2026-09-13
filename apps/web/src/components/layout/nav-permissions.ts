/**
 * Sidebar / chrome permission helpers (W2-UX-03).
 *
 * The staff sidebar previously rendered every module link regardless of the
 * signed-in user's RBAC grants. These helpers keep the nav registry declarative
 * while filtering entries client-side against `AuthUser.permissions` / roles.
 */

export interface NavPermissionItem {
  key: string;
  href: string;
  icon: string;
  /** Empty = visible to any authenticated staff user. */
  requiredPermissions?: readonly string[];
  /** When set, at least one role substring must match (case-insensitive). */
  requiredRoleSubstrings?: readonly string[];
  /** Hide from users whose roles match any of these substrings. */
  hideForRoleSubstrings?: readonly string[];
}

export function roleHaystack(roles: readonly string[] | undefined): string {
  return (roles ?? []).map((r) => r.toLowerCase()).join(' ');
}

export function hasAllPermissions(
  userPermissions: readonly string[],
  required: readonly string[] | undefined,
): boolean {
  if (!required || required.length === 0) return true;
  return required.every((perm) => userPermissions.includes(perm));
}

export function matchesRoleGate(
  haystack: string,
  requiredRoleSubstrings: readonly string[] | undefined,
): boolean {
  if (!requiredRoleSubstrings || requiredRoleSubstrings.length === 0) return true;
  return requiredRoleSubstrings.some((needle) => haystack.includes(needle.toLowerCase()));
}

export function isHiddenForRole(
  haystack: string,
  hideForRoleSubstrings: readonly string[] | undefined,
): boolean {
  if (!hideForRoleSubstrings || hideForRoleSubstrings.length === 0) return false;
  return hideForRoleSubstrings.some((needle) => haystack.includes(needle.toLowerCase()));
}

export function filterNavItemsByAccess<T extends NavPermissionItem>(
  items: readonly T[],
  userPermissions: readonly string[],
  userRoles: readonly string[] | undefined,
): T[] {
  const haystack = roleHaystack(userRoles);
  return items.filter((item) => {
    if (isHiddenForRole(haystack, item.hideForRoleSubstrings)) return false;
    if (!matchesRoleGate(haystack, item.requiredRoleSubstrings)) return false;
    return hasAllPermissions(userPermissions, item.requiredPermissions);
  });
}
