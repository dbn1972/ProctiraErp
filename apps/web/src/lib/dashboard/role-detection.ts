/**
 * Infer the best-fit role dashboard from JWT role claims (G-1003 / W2-UX-04).
 */
import type { TokenPayload } from '@/lib/auth/session';
import type { DashboardRole } from '@/lib/api/reports';

export function detectDashboardRole(roles: TokenPayload['roles'] | undefined): DashboardRole {
  const haystack = (roles ?? [])
    .map((r) => `${r.roleId ?? ''} ${r.roleName ?? ''}`.toLowerCase())
    .join(' ');

  if (haystack.includes('parent') || haystack.includes('guardian')) return 'parent';
  if (haystack.includes('teacher') || haystack.includes('faculty')) return 'teacher';
  if (
    haystack.split(/\s+/).includes('staff') ||
    haystack.includes('clerk') ||
    haystack.includes('counsellor')
  ) {
    return 'staff';
  }
  if (haystack.includes('board') || haystack.includes('trustee')) return 'board';
  if (
    haystack.includes('principal') ||
    haystack.includes('administrator') ||
    haystack.includes('admin') ||
    haystack.includes('super-admin')
  ) {
    return 'principal';
  }

  // W2-UX-04: do not collapse unknown roles into the principal dashboard.
  return 'staff';
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
