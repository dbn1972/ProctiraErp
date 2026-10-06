/**
 * PRC-H004 — canonical school (institution) scope rule shared by the gateway scope hook and
 * per-handler checks in domain packages.
 *
 * A principal is school-bound when its token carries an `institutions` list and none of its roles
 * is on the positive board/tenant admin allowlist below. School-bound principals may only touch
 * records owned by one of their institutions. Handlers that address a record by `:id` (so the
 * gateway cannot see the owning institution in query/params/body) load the record and call
 * {@link assertInstitutionInScope} with its institution before mutating it.
 */
import { NotFoundError } from './exceptions/index.js';

/** Positive allowlist of roles that may cross schools within their tenant. */
export const BOARD_TENANT_ADMIN_ROLE_IDS: readonly string[] = Object.freeze([
  'admin',
  'board_admin',
  'tenant-admin',
  'tenant_admin',
  'platform_admin',
  'super-admin',
  'super_admin',
  'administrator',
]);
const BOARD_TENANT_ADMIN_ROLES = new Set(BOARD_TENANT_ADMIN_ROLE_IDS);

export type InstitutionScopePrincipal = {
  institutions?: unknown;
  roles?: unknown;
};

export function principalRoleIds(
  principal: InstitutionScopePrincipal | null | undefined,
): string[] {
  const roles = principal?.roles;
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role: unknown) => {
      if (typeof role === 'string') return role;
      if (role && typeof role === 'object') {
        const record = role as { roleId?: unknown; roleName?: unknown };
        if (typeof record.roleId === 'string') return record.roleId;
        if (typeof record.roleName === 'string') return record.roleName;
      }
      return '';
    })
    .filter(Boolean);
}

export function principalInstitutions(
  principal: InstitutionScopePrincipal | null | undefined,
): string[] {
  const list = principal?.institutions;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

export function isBoardOrTenantAdminPrincipal(
  principal: InstitutionScopePrincipal | null | undefined,
): boolean {
  return principalRoleIds(principal).some((id) => BOARD_TENANT_ADMIN_ROLES.has(id));
}

export function isSchoolBoundPrincipal(
  principal: InstitutionScopePrincipal | null | undefined,
): boolean {
  if (isBoardOrTenantAdminPrincipal(principal)) return false;
  const list = principal?.institutions;
  if (list === undefined || list === null) return false;
  // Fail closed: a present but malformed claim binds the principal (to no school) rather than
  // silently lifting the restriction.
  if (!Array.isArray(list)) return true;
  return list.length > 0;
}

/**
 * Throws a 404 {@link NotFoundError} when a school-bound principal addresses a record whose owning
 * institution is missing or outside its schools. 404 (not 403) so another school's ownership is not
 * disclosed. Board/tenant admins and principals without an institution list are unaffected (their
 * tenant boundary is enforced elsewhere).
 */
export function assertInstitutionInScope(
  principal: InstitutionScopePrincipal | null | undefined,
  recordInstitutionId: string | null | undefined,
  notFoundMessage = 'Resource not found',
): void {
  if (!isSchoolBoundPrincipal(principal)) return;
  if (!recordInstitutionId || !principalInstitutions(principal).includes(recordInstitutionId)) {
    throw new NotFoundError(notFoundMessage);
  }
}
