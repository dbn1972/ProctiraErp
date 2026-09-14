/**
 * LMS domain RBAC (W1-SEC-02 residual).
 * Teachers / instructors / admins manage coursework, grading, and content.
 * Authenticated learners may submit work, PAL attempts, and discussion posts.
 * Empty / viewer roles fail closed on staff actions.
 */
import { AppError } from '@proctira/common';

export type LmsAction = 'lms.staff' | 'lms.learn';

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

const LMS_STAFF_ROLES = [
  'teacher',
  'instructor',
  'faculty',
  'lms_admin',
  'lms-admin',
  'academic_coordinator',
  'academic-coordinator',
  'registrar',
  ...ADMIN_ROLES,
] as const;

export function normalizeLmsRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (typeof role === 'string') return role.toLowerCase();
      if (role && typeof role === 'object') {
        const obj = role as Record<string, unknown>;
        return String(obj['roleId'] ?? obj['roleName'] ?? obj['id'] ?? '').toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

export function hasLmsAccess(
  roles: unknown,
  action: LmsAction,
  opts?: { hasUser?: boolean },
): boolean {
  if (action === 'lms.learn') {
    return opts?.hasUser === true;
  }
  const normalized = normalizeLmsRoles(roles);
  if (normalized.length === 0) return false;
  return normalized.some((role) => (LMS_STAFF_ROLES as readonly string[]).includes(role));
}

export function assertLmsAccess(
  roles: unknown,
  action: LmsAction,
  opts?: { hasUser?: boolean },
): void {
  if (!hasLmsAccess(roles, action, opts)) {
    throw new AppError(
      `Forbidden: role cannot perform LMS action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}

/** Learner-facing mutating surfaces (submit / PAL attempt / discussion post). */
export function isLmsLearnPath(path: string): boolean {
  const bare = (path.split('?')[0] ?? path).replace(/^\/api\/v1/, '').replace(/\/+$/, '') || '/';
  const under = bare.startsWith('/lms') ? bare.slice('/lms'.length) || '/' : bare;
  if (/^\/assignments\/[^/]+\/submissions$/.test(under)) return true;
  if (/^\/pal\/students\/[^/]+\/attempts$/.test(under)) return true;
  if (/^\/discussions\/[^/]+\/posts$/.test(under)) return true;
  return false;
}

export function lmsActionForRequest(method: string, path: string): LmsAction {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') {
    // Reads: staff OR any authenticated learner (classified as learn + hasUser).
    return 'lms.learn';
  }
  if (isLmsLearnPath(path)) return 'lms.learn';
  return 'lms.staff';
}
