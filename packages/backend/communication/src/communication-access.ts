/**
 * Communication domain RBAC (W1-SEC-02 residual).
 * Communications officers / registrars / admins manage campaigns and circulars.
 * Authenticated principals may acknowledge circulars (communication.portal).
 * Teachers / empty roles denied on staff actions (fail closed).
 */
import { AppError } from '@proctira/common';

export type CommunicationAction = 'communication.staff' | 'communication.portal';

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

const COMMUNICATION_STAFF_ROLES = [
  'communications_officer',
  'communications-officer',
  'communication_officer',
  'communication-officer',
  'communications_admin',
  'communications-admin',
  'registrar',
  ...ADMIN_ROLES,
] as const;

export function normalizeCommunicationRoles(roles: unknown): string[] {
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

export function hasCommunicationAccess(
  roles: unknown,
  action: CommunicationAction,
  opts?: { hasUser?: boolean },
): boolean {
  if (action === 'communication.portal') {
    return opts?.hasUser === true;
  }
  const normalized = normalizeCommunicationRoles(roles);
  if (normalized.length === 0) return false;
  return normalized.some((role) =>
    (COMMUNICATION_STAFF_ROLES as readonly string[]).includes(role),
  );
}

export function assertCommunicationAccess(
  roles: unknown,
  action: CommunicationAction,
  opts?: { hasUser?: boolean },
): void {
  if (!hasCommunicationAccess(roles, action, opts)) {
    throw new AppError(
      `Forbidden: role cannot perform communication action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}

/** Portal-only: circular acknowledgement. All other surfaces are staff CRM. */
export function isCommunicationPortalPath(path: string): boolean {
  const bare = (path.split('?')[0] ?? path).replace(/^\/api\/v1/, '').replace(/\/+$/, '') || '/';
  const under = bare.startsWith('/communication')
    ? bare.slice('/communication'.length) || '/'
    : bare;
  return /^\/circulars\/[^/]+\/ack$/.test(under);
}

export function communicationActionForPath(path: string): CommunicationAction {
  return isCommunicationPortalPath(path) ? 'communication.portal' : 'communication.staff';
}
