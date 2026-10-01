/**
 * Dashboard home helpers (PRC-L052).
 *
 * Quick actions are filtered by the session's RBAC permissions so a guardian or
 * staff account is not shown admin shortcuts that lead to 403 pages. The
 * gateway still authorizes every request; this only decides what to show.
 */
import type { PermissionAction } from '@proctira/auth';

import type { TokenPayload } from '@/lib/auth/session';
import { sessionUserHasPermission } from '@/lib/auth/session-permissions';
import { DEFAULT_TENANT_TIMEZONE } from '@/lib/datetime/tenant-zoned';

export type DashboardQuickActionId =
  'add-student' | 'mark-attendance' | 'import-students' | 'enter-results';

export interface DashboardQuickAction {
  id: DashboardQuickActionId;
  href: string;
  label: string;
  permission: { resource: string; action: PermissionAction };
}

export const DASHBOARD_QUICK_ACTIONS: readonly DashboardQuickAction[] = [
  {
    id: 'add-student',
    href: '/students/new',
    label: 'Add student',
    permission: { resource: 'student', action: 'create' },
  },
  {
    id: 'mark-attendance',
    href: '/attendance',
    label: 'Mark attendance',
    permission: { resource: 'attendance', action: 'create' },
  },
  {
    id: 'import-students',
    href: '/students/import',
    label: 'Bulk import students',
    permission: { resource: 'student', action: 'create' },
  },
  {
    id: 'enter-results',
    href: '/assessments/results',
    label: 'Enter results',
    permission: { resource: 'assessment', action: 'update' },
  },
];

type SessionUser = Pick<TokenPayload, 'sub' | 'tenantId' | 'email' | 'displayName' | 'roles'>;

/** Quick actions the session user is permitted to perform. */
export function visibleQuickActions(user: SessionUser | null | undefined): DashboardQuickAction[] {
  return DASHBOARD_QUICK_ACTIONS.filter((action) =>
    sessionUserHasPermission(user, action.permission.resource, action.permission.action),
  );
}

/** Long-form date for the dashboard header, rendered in the tenant timezone. */
export function formatDashboardDate(now: Date, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  };
  try {
    return now.toLocaleDateString('en-IN', { ...options, timeZone });
  } catch {
    // Misconfigured tenant timezone: fall back to the platform default zone.
    return now.toLocaleDateString('en-IN', { ...options, timeZone: DEFAULT_TENANT_TIMEZONE });
  }
}
