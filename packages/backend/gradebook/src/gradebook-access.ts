/**
 * Gradebook RBAC helpers (SIS harden).
 * Teacher-class roles: grade entry / GPA / report cards.
 * Registrar-class roles: transcript issue (+ admin supersets).
 */
import { AppError } from '@proctira/common';

export type GradebookAction =
  | 'grade.entry'
  | 'grade.moderate'
  | 'gpa.compute'
  | 'report_card.create'
  | 'transcript.issue'
  | 'credit_rule.write'
  | 'board_export.create'
  // PRC-C006/C007: staff read of gradebook surfaces (grades, GPA, ranks, transcripts, audits,
  // board exports, report cards). Read routes previously had no domain role check, so any
  // tenant user could read all grades/transcripts and download board-export PII.
  | 'grade.read.staff';

const ADMIN_ROLES = ['admin', 'super-admin', 'system_admin', 'principal', 'school_admin'] as const;

const TEACHER_ROLES = ['teacher', 'class_teacher', 'subject_teacher', ...ADMIN_ROLES] as const;

const REGISTRAR_ROLES = [
  'registrar',
  'board_officer',
  'examinations_officer',
  ...ADMIN_ROLES,
] as const;

// Staff who may read gradebook surfaces: teachers + registrar/exam officers + admins.
// Portal roles (parent/student/guardian) are NOT here; their access is self-scoped separately.
const READ_STAFF_ROLES = [...new Set<string>([...TEACHER_ROLES, ...REGISTRAR_ROLES])] as const;

const ACTION_ROLES: Record<GradebookAction, readonly string[]> = {
  'grade.entry': TEACHER_ROLES,
  'grade.moderate': REGISTRAR_ROLES,
  'gpa.compute': TEACHER_ROLES,
  'report_card.create': TEACHER_ROLES,
  'transcript.issue': REGISTRAR_ROLES,
  'credit_rule.write': REGISTRAR_ROLES,
  'board_export.create': REGISTRAR_ROLES,
  'grade.read.staff': READ_STAFF_ROLES,
};

export function normalizeRoles(roles: unknown): string[] {
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

export function hasGradebookAccess(roles: unknown, action: GradebookAction): boolean {
  const normalized = normalizeRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertGradebookAccess(roles: unknown, action: GradebookAction): void {
  if (!hasGradebookAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform gradebook action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}
