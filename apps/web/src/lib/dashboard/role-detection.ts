/**
 * Infer the best-fit role dashboard from JWT role claims (G-1003).
 */
import type { TokenPayload } from '@/lib/auth/session';
import type { DashboardRole } from '@/lib/api/reports';

export function detectDashboardRole(roles: TokenPayload['roles'] | undefined): DashboardRole {
  const haystack = (roles ?? [])
    .map((r) => `${r.roleId ?? ''} ${r.roleName ?? ''}`.toLowerCase())
    .join(' ');

  if (haystack.includes('parent') || haystack.includes('guardian')) return 'parent';
  if (haystack.includes('board')) return 'board';
  if (haystack.includes('teacher') || haystack.includes('faculty')) return 'teacher';
  if (
    haystack.includes('principal') ||
    haystack.includes('administrator') ||
    haystack.includes('admin')
  ) {
    return 'principal';
  }

  return 'principal';
}

export function dashboardRoleLabel(role: DashboardRole): string {
  switch (role) {
    case 'board':
      return 'Board';
    case 'principal':
      return 'Principal';
    case 'teacher':
      return 'Teacher';
    case 'parent':
      return 'Parent';
    default:
      return role;
  }
}
