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

/**
 * PRC-M194: teacher -> subject ownership (topic 3 Option A). Admin-tier roles,
 * academic / curriculum coordinators and the registrar act across the
 * institution; teacher-only roles (teacher, instructor, faculty) may write
 * units, lesson plans, coverage and outcomes only for subjects they teach.
 * Matched on role ids only, so a tenant-editable role name cannot lift a
 * teacher out of the check.
 */
export interface CurriculumTeachingScope {
  teachesSubject(
    tenantId: string,
    principalIds: readonly string[],
    subjectId: string,
  ): Promise<boolean>;
}

const INSTITUTION_WIDE_ROLE_IDS: ReadonlySet<string> = new Set(
  CURRICULUM_STAFF_ROLES.filter(
    (role) => role !== 'teacher' && role !== 'instructor' && role !== 'faculty',
  ),
);

export function hasInstitutionWideCurriculumRole(roles: unknown): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((r) => {
    const id =
      typeof r === 'string'
        ? r
        : r && typeof r === 'object'
          ? (r as { roleId?: unknown }).roleId
          : undefined;
    return typeof id === 'string' && INSTITUTION_WIDE_ROLE_IDS.has(id.toLowerCase());
  });
}
