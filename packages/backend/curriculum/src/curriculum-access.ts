/**
 * Curriculum domain RBAC (W1-SEC-02 residual).
 * Teachers / academic coordinators manage units, lesson plans, and outcomes.
 * Parents / viewers / empty roles fail closed.
 */
import { AppError } from '@proctira/common';

export type CurriculumAction = 'curriculum.read' | 'curriculum.write';

const ADMIN_ROLES = [
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'administrator',
  'principal',
  'school_admin',
  'school-admin',
] as const;

const CURRICULUM_STAFF_ROLES = [
  'teacher',
  'instructor',
  'faculty',
  'academic_coordinator',
  'academic-coordinator',
  'curriculum_coordinator',
  'curriculum-coordinator',
  'registrar',
  ...ADMIN_ROLES,
] as const;

const ACTION_ROLES: Record<CurriculumAction, readonly string[]> = {
  'curriculum.read': CURRICULUM_STAFF_ROLES,
  'curriculum.write': CURRICULUM_STAFF_ROLES,
};

export function normalizeCurriculumRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (typeof role === 'string') return role.toLowerCase();
      if (role && typeof role === 'object') {
        const obj = role as { roleId?: string; roleName?: string; id?: string };
        return String(obj.roleId ?? obj.roleName ?? obj.id ?? '').toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

export function hasCurriculumAccess(roles: unknown, action: CurriculumAction): boolean {
  const normalized = normalizeCurriculumRoles(roles);
  if (normalized.length === 0) return false;
  return normalized.some((role) => ACTION_ROLES[action].includes(role));
}

export function assertCurriculumAccess(roles: unknown, action: CurriculumAction): void {
  if (!hasCurriculumAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform curriculum action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}
