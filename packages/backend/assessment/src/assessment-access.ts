/**
 * Assessment domain RBAC (W1-SEC-02 residual).
 * Teachers / academic staff manage schemes, items, results, and report cards.
 * Parents / viewers / empty roles fail closed.
 */
import { AppError } from '@proctira/common';

export type AssessmentAction = 'assessment.read' | 'assessment.write' | 'assessment.configure';

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
  'examinations_officer',
  'registrar',
  ...ADMIN_ROLES,
] as const;

/**
 * PRC-M160: read vs write vs configure. The registrar reads assessment data
 * but does not author marks; grading schemes, report-card templates and
 * outcome deletion are configuration owned by admins, academic coordinators
 * and exam officers, not by teachers.
 */
const ASSESSMENT_AUTHOR_ROLES = ASSESSMENT_STAFF_ROLES.filter((role) => role !== 'registrar');
const ASSESSMENT_CONFIG_ROLES = [
  'academic_coordinator',
  'academic-coordinator',
  'examinations_officer',
  ...ADMIN_ROLES,
] as const;
const ACTION_ROLES: Record<AssessmentAction, readonly string[]> = {
  'assessment.read': ASSESSMENT_STAFF_ROLES,
  'assessment.write': ASSESSMENT_AUTHOR_ROLES,
  'assessment.configure': ASSESSMENT_CONFIG_ROLES,
};

/** PRC-M163: admin-tier roles that may overwrite another author's comment. */
export function isAssessmentAdmin(roles: unknown): boolean {
  const normalized = normalizeAssessmentRoles(roles);
  return normalized.some((role) => (ADMIN_ROLES as readonly string[]).includes(role));
}

/**
 * PRC-L080: the report-card job reprocess endpoint is an operator surface, not a
 * teacher one. Only admin-tier roles or exam officers may drive it. Teachers
 * (and other assessment.write holders) are denied even though they can author
 * grades.
 */
const REPORT_CARD_OPERATOR_ROLES = [...ADMIN_ROLES, 'examinations_officer'] as const;

export function isReportCardOperator(roles: unknown): boolean {
  const normalized = normalizeAssessmentRoles(roles);
  return normalized.some((role) =>
    (REPORT_CARD_OPERATOR_ROLES as readonly string[]).includes(role),
  );
}

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
