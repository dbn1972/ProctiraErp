/**
 * Assessment domain RBAC (W1-SEC-02 residual).
 * Teachers / academic staff manage schemes, items, results, and report cards.
 * Parents / viewers / empty roles fail closed.
 */
import { AppError } from '@proctira/common';

export type AssessmentAction = 'assessment.read' | 'assessment.write';

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

const ASSESSMENT_STAFF_ROLES = [
  'teacher',
  'instructor',
  'faculty',
  'academic_coordinator',
  'academic-coordinator',
  'exam_officer',
  'exam-officer',
  'registrar',
  ...ADMIN_ROLES,
] as const;

const ACTION_ROLES: Record<AssessmentAction, readonly string[]> = {
  'assessment.read': ASSESSMENT_STAFF_ROLES,
  'assessment.write': ASSESSMENT_STAFF_ROLES,
};

export function normalizeAssessmentRoles(roles: unknown): string[] {
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

export function hasAssessmentAccess(roles: unknown, action: AssessmentAction): boolean {
  const normalized = normalizeAssessmentRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertAssessmentAccess(roles: unknown, action: AssessmentAction): void {
  if (!hasAssessmentAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform assessment action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}
