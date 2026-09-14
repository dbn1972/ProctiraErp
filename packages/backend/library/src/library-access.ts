/**
 * Library domain RBAC (W1-SEC-02 residual).
 * Librarians / registrars / admins manage catalog, circulation, and fines.
 * Teachers / viewers / empty roles are denied (fail closed).
 * Parents / guardians / students may only perform library.portal (bound reads).
 */
import { AppError } from '@proctira/common';

export type LibraryAction = 'library.read' | 'library.write' | 'library.portal';

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

const LIBRARY_STAFF_ROLES = [
  'librarian',
  'library_officer',
  'library-officer',
  'library_manager',
  'library-manager',
  'library_admin',
  'library-admin',
  'library_clerk',
  'library-clerk',
  'registrar',
  ...ADMIN_ROLES,
] as const;

const PORTAL_ROLES = ['parent', 'guardian', 'student'] as const;

const ACTION_ROLES: Record<LibraryAction, readonly string[]> = {
  'library.read': LIBRARY_STAFF_ROLES,
  'library.write': LIBRARY_STAFF_ROLES,
  'library.portal': PORTAL_ROLES,
};

export function normalizeLibraryRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (typeof role === 'string') return role.toLowerCase();
      if (role && typeof role === 'object') {
        const obj = role as Record<string, unknown>;
        const raw =
          obj['roleId'] ??
          obj['roleName'] ??
          obj['id'] ??
          '';
        return String(raw).toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

export function hasLibraryAccess(roles: unknown, action: LibraryAction): boolean {
  const normalized = normalizeLibraryRoles(roles);
  if (normalized.length === 0) return false;
  const allowed = ACTION_ROLES[action];
  return normalized.some((role) => allowed.includes(role));
}

export function assertLibraryAccess(roles: unknown, action: LibraryAction): void {
  if (!hasLibraryAccess(roles, action)) {
    throw new AppError(
      `Forbidden: role cannot perform library action ${action}`,
      'FORBIDDEN',
      403,
    );
  }
}

/**
 * Staff may read/write; portal principals may only use library.portal on reads.
 */
export function libraryActionForMethod(method: string, roles: unknown): LibraryAction {
  const upper = method.toUpperCase();
  const isRead = upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
  if (!isRead) return 'library.write';
  if (hasLibraryAccess(roles, 'library.read')) return 'library.read';
  return 'library.portal';
}
