/**
 * Transport domain RBAC (W1-SEC-02 residual).
 * Transport officers / fleet managers / admins manage routes, vehicles, and ops.
 * Teachers / parents / viewers / empty roles are denied (fail closed).
 */
import { AppError } from '@proctira/common';

export type TransportAction = 'transport.read' | 'transport.write' | 'transport.ops';

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

const TRANSPORT_STAFF_ROLES = [
  'transport_officer',
  'transport-officer',
  'transport_manager',
  'transport-manager',
  'fleet_manager',
  'fleet-manager',
  'transport_admin',
  'transport-admin',
  'registrar',
  ...ADMIN_ROLES,
] as const;

const ACTION_ROLES: Record<TransportAction, readonly string[]> = {
  'transport.read': TRANSPORT_STAFF_ROLES,
  'transport.write': TRANSPORT_STAFF_ROLES,
  'transport.ops': TRANSPORT_STAFF_ROLES,
};

export function normalizeTransportRoles(roles: unknown): string[] {
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

export function hasTransportAccess(roles: unknown, action: TransportAction): boolean {
  const normalized = normalizeTransportRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertTransportAccess(roles: unknown, action: TransportAction): void {
  if (!hasTransportAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform transport action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}
