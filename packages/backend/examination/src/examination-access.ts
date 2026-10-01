/**
 * Examination domain RBAC (production harden for ≥9.0).
 * Officer/registrar: create, update, publish, register candidates, documents, ops.
 * Teachers are denied mutations (read paths stay separate).
 */
import { AppError } from '@proctira/common';

export type ExaminationAction =
  | 'exam.create'
  | 'exam.update'
  | 'exam.delete'
  | 'exam.publish'
  | 'candidate.register'
  | 'document.generate'
  | 'ops.moderate'
  // PRC-C004: staff-only read of officer surfaces (results, raw marks, seating, invigilators,
  // re-evaluations, document jobs/PDFs). Gateway examination:read is held by student/teacher/
  // staff, so these GET routes previously had no domain check.
  | 'exam.read.staff';

const ADMIN_ROLES = [
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'principal',
  'school_admin',
] as const;

const EXAM_OFFICER_ROLES = [
  'examinations_officer',
  'exam_officer',
  'registrar',
  'board_officer',
  ...ADMIN_ROLES,
] as const;

// Staff who may read examination officer surfaces. Teachers are included (they mark and review
// their candidates) alongside exam officers/registrars/admins. Students/guardians are excluded —
// learner result access must go through a self-scoped endpoint, not these staff routes.
const EXAM_READ_STAFF_ROLES = [
  'teacher',
  'class_teacher',
  'subject_teacher',
  'invigilator',
  ...EXAM_OFFICER_ROLES,
] as const;

const ACTION_ROLES: Record<ExaminationAction, readonly string[]> = {
  'exam.create': EXAM_OFFICER_ROLES,
  'exam.update': EXAM_OFFICER_ROLES,
  'exam.delete': ['examinations_officer', 'exam_officer', 'registrar', ...ADMIN_ROLES],
  'exam.publish': EXAM_OFFICER_ROLES,
  'candidate.register': EXAM_OFFICER_ROLES,
  'document.generate': EXAM_OFFICER_ROLES,
  'ops.moderate': EXAM_OFFICER_ROLES,
  'exam.read.staff': EXAM_READ_STAFF_ROLES,
};

export function normalizeExaminationRoles(roles: unknown): string[] {
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

export function hasExaminationAccess(roles: unknown, action: ExaminationAction): boolean {
  const normalized = normalizeExaminationRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertExaminationAccess(roles: unknown, action: ExaminationAction): void {
  if (!hasExaminationAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform examination action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}
