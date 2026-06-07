/**
 * Platform admin role separation.
 *
 * Charter: Section 41 (Support, Break-Glass, Internal Access).
 * Each platform admin operator is assigned exactly one functional role.
 * Pages enforce role membership via `requireRole()` so that, for example,
 * the billing team cannot perform plugin marketplace approvals.
 */

/** Functional roles within the Platform Admin Console. */
export type PlatformRole =
  | 'platform_admin'
  | 'ops_support'
  | 'billing'
  | 'security'
  | 'engineering';

/** All platform roles, in the order presented in the UI. */
export const PLATFORM_ROLES: PlatformRole[] = [
  'platform_admin',
  'ops_support',
  'billing',
  'security',
  'engineering',
];

/** Human-readable labels for each role. */
export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  platform_admin: 'Platform Admin',
  ops_support: 'Ops Support',
  billing: 'Billing',
  security: 'Security',
  engineering: 'Engineering',
};

/**
 * Maps each functional area to the roles allowed to access it.
 * `platform_admin` is implicitly allowed everywhere; this is enforced by
 * `hasRole()` so it never needs to appear in the per-area lists.
 */
export const AREA_ROLES = {
  /** Tenant lifecycle, plans, entitlements. */
  tenants: ['billing'] as PlatformRole[],
  plans: ['billing'] as PlatformRole[],
  /** Plugin marketplace approval / revocation. */
  plugins: ['security'] as PlatformRole[],
  /** Theme review and approval. */
  themes: ['security'] as PlatformRole[],
  /** Break-glass approvals. Engineering may *request*, security may *approve*. */
  breakGlassRequest: ['security', 'engineering', 'ops_support'] as PlatformRole[],
  breakGlassApprove: ['security'] as PlatformRole[],
  /** Support tooling — masquerade, impact-scope. */
  support: ['ops_support'] as PlatformRole[],
  /** System health dashboard. */
  health: ['ops_support', 'engineering', 'security', 'billing'] as PlatformRole[],
  /** Audit log — visible to everyone for transparency. */
  audit: ['ops_support', 'engineering', 'security', 'billing'] as PlatformRole[],
} as const;

export type AdminArea = keyof typeof AREA_ROLES;

/** Returns true when `role` is allowed in the given functional area. */
export function hasRole(role: PlatformRole | undefined, area: AdminArea): boolean {
  if (!role) return false;
  if (role === 'platform_admin') return true;
  return AREA_ROLES[area].includes(role);
}
