/**
 * Timetable / master-schedule RBAC (SIS harden #2).
 */
import { AppError } from '@proctira/common';

export type TimetableAction = 'schedule.write' | 'schedule.publish';

const ADMIN_ROLES = ['admin', 'super-admin', 'system_admin', 'principal', 'school_admin'] as const;

const SCHEDULER_ROLES = ['registrar', 'scheduler', 'timetable_officer', ...ADMIN_ROLES] as const;

const ACTION_ROLES: Record<TimetableAction, readonly string[]> = {
  'schedule.write': SCHEDULER_ROLES,
  'schedule.publish': SCHEDULER_ROLES,
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
