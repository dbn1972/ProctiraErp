/**
 * PRC-H001 — per-area platform RBAC at the gateway.
 *
 * The platform admin console (apps/admin-console/src/lib/auth/roles.ts) enforces
 * Section-41 separation of duties in UI code only: the gateway previously admitted
 * ANY platform_admin/super-admin token to EVERY console route, so one platform_admin
 * could suspend tenants, approve plugins AND approve break-glass regardless of
 * functional role, and a narrower platform role (billing/security/ops_support/
 * engineering) was rejected everywhere.
 *
 * This module mirrors the console's canonical PLATFORM_ROLES / AREA_ROLES so the
 * gateway enforces the same per-area rule server-side. `platform-area-rbac.parity`
 * (test) asserts the two stay in lock-step. platform_admin/super-admin keep full
 * access; a narrower role is 403 outside its areas.
 */

/** Functional roles within the Platform Admin Console (mirror of admin-console). */
export type PlatformRole =
  'platform_admin' | 'ops_support' | 'billing' | 'security' | 'engineering';

export const PLATFORM_ROLES: readonly PlatformRole[] = [
  'platform_admin',
  'ops_support',
  'billing',
  'security',
  'engineering',
];

/**
 * Maps each functional area to the NARROWER roles allowed to access it.
 * platform_admin/super-admin are allowed everywhere (handled in hasAreaAccess),
 * so they never appear here. Mirror of admin-console AREA_ROLES.
 */
export const AREA_ROLES = {
  tenants: ['billing'],
  plans: ['billing'],
  plugins: ['security'],
  themes: ['security'],
  breakGlassRequest: ['security', 'engineering', 'ops_support'],
  breakGlassApprove: ['security'],
  support: ['ops_support'],
  health: ['ops_support', 'engineering', 'security', 'billing'],
  audit: ['ops_support', 'engineering', 'security', 'billing'],
} as const satisfies Record<string, readonly PlatformRole[]>;

export type AdminArea = keyof typeof AREA_ROLES;

/** super-admin is the DEFAULT_ROLES equivalent of platform_admin for console access. */
const FULL_ACCESS_ROLE_IDS = new Set(['platform_admin', 'super-admin']);

function roleIdOf(role: unknown): string | undefined {
  if (typeof role === 'string') return role;
  if (role && typeof role === 'object' && 'roleId' in role) {
    const id = (role as { roleId?: unknown }).roleId;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

/**
 * Normalised platform role ids a token carries (lowercased), restricted to the
 * known PLATFORM_ROLES plus the super-admin alias.
 */
export function platformRoleIds(roles: unknown): Set<string> {
  const ids = Array.isArray(roles)
    ? roles.map((r) => roleIdOf(r)).filter((id): id is string => typeof id === 'string')
    : [];
  return new Set(ids.map((id) => id.trim().toLowerCase()));
}

/** True when the token holds any platform console role at all (full or narrow). */
export function isAnyPlatformRole(roles: unknown): boolean {
  const ids = platformRoleIds(roles);
  if ([...FULL_ACCESS_ROLE_IDS].some((id) => ids.has(id))) return true;
  return PLATFORM_ROLES.some((role) => ids.has(role));
}

/** True when the token holds a full-access platform role (platform_admin/super-admin). */
export function isFullAccessPlatformRole(roles: unknown): boolean {
  const ids = platformRoleIds(roles);
  return [...FULL_ACCESS_ROLE_IDS].some((id) => ids.has(id));
}

/**
 * Does the caller's platform role(s) grant access to `area`?
 * platform_admin/super-admin: always. A narrower role: only when AREA_ROLES lists it.
 */
export function hasAreaAccess(roles: unknown, area: AdminArea): boolean {
  if (isFullAccessPlatformRole(roles)) return true;
  const ids = platformRoleIds(roles);
  return AREA_ROLES[area].some((role) => ids.has(role));
}

/**
 * Resolve the console area for a request to the platform-admin plugin.
 * `pathname` is the plugin-relative path (no `/api/v1` prefix); `method` is the
 * HTTP verb. Returns undefined for paths with no area mapping (treated as full-
 * access-only by the caller).
 */
export function areaForPlatformRoute(method: string, pathname: string): AdminArea | undefined {
  const path = (pathname.split('?')[0] ?? pathname).replace(/\/+$/, '') || '/';
  const upper = method.toUpperCase();
  const parts = path.split('/').filter(Boolean);
  // Tolerate an optional `/api/v1` prefix (the plugin's route pattern is mounted under it).
  const seg = parts[0] === 'api' && parts[1] === 'v1' ? parts.slice(2) : parts;
  const head = seg[0];

  if (head === 'tenants') return 'tenants';
  if (head === 'plans') return 'plans';
  if (head === 'plugins') return 'plugins';
  if (head === 'themes') return 'themes';
  if (head === 'health' || (head === 'platform' && seg[1] === 'health')) return 'health';
  if (head === 'audit' || (head === 'platform' && seg[1] === 'audit')) return 'audit';
  if (head === 'break-glass') {
    // Approve/deny/revoke are the dual-control decision (security only); everything
    // else on break-glass (create request, list, read) is the request area.
    const verb = seg[2];
    if (upper === 'POST' && (verb === 'approve' || verb === 'deny' || verb === 'revoke')) {
      return 'breakGlassApprove';
    }
    return 'breakGlassRequest';
  }
  return undefined;
}
