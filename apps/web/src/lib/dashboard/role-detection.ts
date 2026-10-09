/**
 * Infer the best-fit role dashboard from JWT role claims (G-1003 / W2-UX-04).
 */
import type { TokenPayload } from '@/lib/auth/session';
import type { DashboardRole } from '@/lib/api/reports';

type DashboardRoleClaim = Pick<TokenPayload['roles'][number], 'roleId' | 'roleName'>;

export function detectDashboardRole(
  roles: readonly DashboardRoleClaim[] | undefined,
): DashboardRole {
  // PRC-L271: match on canonical role tokens with an explicit precedence,
  // instead of substring `.includes()` over a joined haystack. Substring
  // matching misclassified combined/custom names (e.g. "board-admin" matched
  // both "board" and "admin"; "superadmin" never tokenised). We tokenise each
  // role id/name on non-alphanumerics and compare whole tokens.
  const tokens = new Set<string>();
  for (const r of roles ?? []) {
    for (const source of [r.roleId, r.roleName]) {
      for (const token of String(source ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)) {
        tokens.add(token);
      }
    }
  }

  const has = (...candidates: string[]) => candidates.some((c) => tokens.has(c));

  // Highest-trust/most-specific role wins. Parent/guardian first so a user who
  // is both a guardian and staff sees the parent dashboard; admin/principal
  // outrank generic staff.
  if (has('parent', 'guardian')) return 'parent';
  if (has('board', 'trustee')) return 'board';
  if (has('principal', 'administrator', 'admin') || hasHyphenated(tokens, 'super', 'admin')) {
    return 'principal';
  }
  if (has('teacher', 'faculty')) return 'teacher';
  if (has('staff', 'clerk', 'counsellor', 'counselor')) return 'staff';

  // W2-UX-04: do not collapse unknown roles into the principal dashboard.
  return 'staff';
}

/** True when a hyphenated role like "super-admin" tokenised into both parts. */
function hasHyphenated(tokens: Set<string>, a: string, b: string): boolean {
  return tokens.has(a) && tokens.has(b);
}

export function dashboardRoleLabel(role: DashboardRole): string {
  switch (role) {
    case 'board':
      return 'Board';
    case 'principal':
      return 'Principal';
    case 'teacher':
      return 'Teacher';
    case 'staff':
      return 'Staff';
    case 'parent':
      return 'Parent';
    default:
      return role;
  }
}
