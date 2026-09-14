/**
 * Notification domain RBAC (W1-SEC-02 residual).
 * Admins / notification officers manage broadcast send, rules, and templates.
 * Any authenticated principal may manage own prefs/devices/inbox (notification.self).
 * Missing user context fails closed.
 */
import { AppError } from '@proctira/common';

export type NotificationAction = 'notification.self' | 'notification.staff';

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

const NOTIFICATION_STAFF_ROLES = [
  'notification_officer',
  'notification-officer',
  'notification_admin',
  'notification-admin',
  'communications_officer',
  'communications-officer',
  'registrar',
  ...ADMIN_ROLES,
] as const;

export function normalizeNotificationRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (typeof role === 'string') return role.toLowerCase();
      if (role && typeof role === 'object') {
        const obj = role as Record<string, unknown>;
        const raw = obj['roleId'] ?? obj['roleName'] ?? obj['id'] ?? '';
        return String(raw).toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

export function hasNotificationAccess(
  roles: unknown,
  action: NotificationAction,
  opts?: { hasUser?: boolean },
): boolean {
  if (action === 'notification.self') {
    return opts?.hasUser === true;
  }
  const normalized = normalizeNotificationRoles(roles);
  if (normalized.length === 0) return false;
  return normalized.some((role) =>
    (NOTIFICATION_STAFF_ROLES as readonly string[]).includes(role),
  );
}

export function assertNotificationAccess(
  roles: unknown,
  action: NotificationAction,
  opts?: { hasUser?: boolean },
): void {
  if (!hasNotificationAccess(roles, action, opts)) {
    throw new AppError(
      `Forbidden: role cannot perform notification action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}

/** Staff-only surfaces: broadcast send, rules, templates. */
export function isNotificationStaffPath(path: string): boolean {
  const bare = path.split('?')[0] ?? path;
  const normalized = bare.replace(/^\/api\/v1/, '').replace(/\/+$/, '') || '/';
  const under = normalized.startsWith('/notifications')
    ? normalized.slice('/notifications'.length) || '/'
    : normalized;

  if (under === '/send') return true;
  if (under === '/rules' || under.startsWith('/rules/')) return true;
  if (under === '/templates' || under.startsWith('/templates/')) return true;
  return false;
}

export function notificationActionForPath(path: string): NotificationAction {
  return isNotificationStaffPath(path) ? 'notification.staff' : 'notification.self';
}
