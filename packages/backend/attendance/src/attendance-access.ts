/**
 * Attendance domain RBAC (W1-SEC-02 residual).
 * Teachers / attendance officers record; officers+admins approve; empty roles deny.
 * Device ingest is exempted at the HTTP guard (API-key auth).
 */
import { AppError } from '@proctira/common';

export type AttendanceAction = 'attendance.read' | 'attendance.write' | 'attendance.approve';

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

const ATTENDANCE_WRITE_ROLES = [
  'teacher',
  'class_teacher',
  'class-teacher',
  'attendance_officer',
  'attendance-officer',
  'registrar',
  ...ADMIN_ROLES,
] as const;

const ATTENDANCE_APPROVE_ROLES = [
  'attendance_officer',
  'attendance-officer',
  'registrar',
  ...ADMIN_ROLES,
] as const;

const ACTION_ROLES: Record<AttendanceAction, readonly string[]> = {
  'attendance.read': ATTENDANCE_WRITE_ROLES,
  'attendance.write': ATTENDANCE_WRITE_ROLES,
  'attendance.approve': ATTENDANCE_APPROVE_ROLES,
};

export function normalizeAttendanceRoles(roles: unknown): string[] {
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

export function hasAttendanceAccess(roles: unknown, action: AttendanceAction): boolean {
  const normalized = normalizeAttendanceRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertAttendanceAccess(roles: unknown, action: AttendanceAction): void {
  if (!hasAttendanceAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform attendance action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}
