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
  | 'ops.moderate';

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

const ACTION_ROLES: Record<ExaminationAction, readonly string[]> = {
  'exam.create': EXAM_OFFICER_ROLES,
  'exam.update': EXAM_OFFICER_ROLES,
  'exam.delete': ['examinations_officer', 'exam_officer', 'registrar', ...ADMIN_ROLES],
  'exam.publish': EXAM_OFFICER_ROLES,
  'candidate.register': EXAM_OFFICER_ROLES,
  'document.generate': EXAM_OFFICER_ROLES,
  'ops.moderate': EXAM_OFFICER_ROLES,
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
