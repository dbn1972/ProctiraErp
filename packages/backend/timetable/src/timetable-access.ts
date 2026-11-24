/**
 * Timetable / master-schedule RBAC (SIS harden #2).
 */
import { AppError } from '@proctira/common';

/**
 * `schedule.read`: staff-only reads (rosters, generation jobs, absences) — PRC-M406.
 * `substitution.read`: the substitution desk list (absent + covering teacher, date and the
 * free-text reason, e.g. medical leave) — S-D2. Same roles that may create substitutions.
 */
export type TimetableAction =
  'schedule.write' | 'schedule.publish' | 'schedule.read' | 'substitution.read';

const ADMIN_ROLES = [
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'principal',
  'school_admin',
] as const;

/**
 * PRC-L174: `scheduler` (the realm spells it `timetable_officer`) and
 * `coordinator` were dropped; neither is a realm or gateway-registry role, so
 * no token carrying them reached this guard. `platform_admin` is NOT in
 * ADMIN_ROLES (D2 CORRECTION: control-plane operator, no tenant timetable
 * data); tenant admins (`admin`, `system_admin`) are. `hod` / `academic_coordinator` and the legacy admin
 * spellings are shared with report/assessment/curriculum/lms and wait on the
 * catalogue decision for those roles.
 */
const SCHEDULER_ROLES = ['registrar', 'timetable_officer', ...ADMIN_ROLES] as const;

/** School staff who may see rosters / scheduling internals (never student/parent/guardian). */
const STAFF_READ_ROLES = [
  'teacher',
  'staff',
  'staff_admin',
  'hod',
  'academic_coordinator',
  ...SCHEDULER_ROLES,
] as const;
const ACTION_ROLES: Record<TimetableAction, readonly string[]> = {
  'schedule.write': SCHEDULER_ROLES,
  'schedule.publish': SCHEDULER_ROLES,
  'schedule.read': STAFF_READ_ROLES,
  'substitution.read': SCHEDULER_ROLES,
};

export function normalizeTimetableRoles(roles: unknown): string[] {
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

export function hasTimetableAccess(roles: unknown, action: TimetableAction): boolean {
  const normalized = normalizeTimetableRoles(roles);
  if (normalized.length === 0) return false;
  return normalized.some((role) => ACTION_ROLES[action].includes(role));
}

export function assertTimetableAccess(roles: unknown, action: TimetableAction): void {
  if (!hasTimetableAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform timetable action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}
