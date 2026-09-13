/**
 * Student PII write RBAC helpers (PRD-005).
 * Registrar / admissions / admin may mutate student records; teachers/viewers denied.
 */
import { AppError } from '@proctira/common';

export type StudentWriteAction = 'student.create' | 'student.update' | 'student.delete';

/** Roles that may list/read student records (aligned with gateway student.read). */
const READ_ROLES = [
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
  'registrar',
  'admissions_officer',
  'student_affairs',
  'data_clerk',
  'teacher',
  'staff',
  'nurse',
  'guardian',
  'parent',
  'student',
] as const;

const ADMIN_ROLES = [
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'system-admin',
  'principal',
  'school_admin',
  'school-admin',
] as const;

const REGISTRAR_ROLES = [
  'registrar',
  'admissions_officer',
  'student_affairs',
  'data_clerk',
  ...ADMIN_ROLES,
] as const;

const ACTION_ROLES: Record<StudentWriteAction, readonly string[]> = {
  'student.create': REGISTRAR_ROLES,
  'student.update': REGISTRAR_ROLES,
  'student.delete': ['registrar', ...ADMIN_ROLES],
};

export function normalizeStudentRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => {
      if (typeof r === 'string') return r.toLowerCase();
      if (r && typeof r === 'object') {
        const obj = r as { roleId?: string; roleName?: string; id?: string };
        return String(obj.roleId ?? obj.roleName ?? obj.id ?? '').toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

export function hasStudentWriteAccess(roles: unknown, action: StudentWriteAction): boolean {
  const normalized = normalizeStudentRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertStudentWriteAccess(roles: unknown, action: StudentWriteAction): void {
  if (!hasStudentWriteAccess(roles, action)) {
    throw new AppError(`Forbidden: role cannot perform ${action}`, 'FORBIDDEN', 403);
  }
}

export function hasStudentReadAccess(roles: unknown): boolean {
  const normalized = normalizeStudentRoles(roles);
  if (normalized.length === 0) return false;
  return normalized.some((role) => (READ_ROLES as readonly string[]).includes(role));
}

export function assertStudentReadAccess(roles: unknown): void {
  if (!hasStudentReadAccess(roles)) {
    throw new AppError('Forbidden: role cannot read student records', 'FORBIDDEN', 403);
  }
}
