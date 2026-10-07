/**
 * PRC-H111: per-case access scope for disciplinary / counselling / complaint cases.
 *
 * Cases are records about minors, so visibility is decided from the verified
 * principal (JWT), never from request parameters:
 *
 * - Tenant-wide administrators (`admin`, `super-admin`, `platform_admin`) see every
 *   case in the tenant.
 * - The case assignee always sees (and can work) their own case.
 * - Otherwise the caller must hold a role permitted for the case type AND the case
 *   must sit in one of the caller's institutions (JWT `institutions` / role
 *   `institutionId`) or areas (JWT `areas`, exact match only — area hierarchy is not
 *   resolved at this layer, so descendants fail closed).
 *
 * Roles are matched on the stable `roleId` only. `roleName` is tenant-editable
 * display text and is never trusted.
 */
import type { FastifyRequest } from 'fastify';

import type { CaseEntity } from './case-repository.js';
import type { CaseType } from './case-schemas.js';

/** Verified caller for case operations. */
export interface CasePrincipal {
  userId: string;
  /** Role ids (never role names). */
  roles: readonly string[];
  institutionIds: readonly string[];
  areaIds: readonly string[];
}

/** Role ids that see every case in their tenant. */
export const TENANT_WIDE_CASE_ROLES: readonly string[] = ['admin', 'super-admin', 'platform_admin'];

/** Case type -> role ids allowed to work cases of that type within their scope. */
export const CASE_TYPE_ROLES: Readonly<Record<CaseType, readonly string[]>> = {
  counselling: ['counsellor', 'principal'],
  disciplinary: ['counsellor', 'principal', 'discipline_officer'],
  complaint: ['counsellor', 'principal', 'discipline_officer'],
};

const ALL_CASE_TYPES = Object.keys(CASE_TYPE_ROLES) as CaseType[];

/**
 * Repository-level visibility predicate. A row is visible when
 * `assigned_to = assigneeId` OR (`type IN types` AND
 * (`institution_id IN institutionIds` OR `area_id IN areaIds`)).
 */
export interface CaseScope {
  assigneeId: string;
  types: readonly CaseType[];
  institutionIds: readonly string[];
  areaIds: readonly string[];
}

function hasAnyRole(principal: CasePrincipal, roles: readonly string[]): boolean {
  return principal.roles.some((r) => roles.includes(r));
}

export function isTenantWideCaseRole(principal: CasePrincipal): boolean {
  return hasAnyRole(principal, TENANT_WIDE_CASE_ROLES);
}

/** Case types the principal may work by role (excluding assignee access). */
export function caseTypesFor(principal: CasePrincipal): CaseType[] {
  return ALL_CASE_TYPES.filter((t) => hasAnyRole(principal, CASE_TYPE_ROLES[t]));
}

/**
 * Scope to apply to list queries; `undefined` means tenant-wide (no restriction).
 */
export function caseScopeFor(principal: CasePrincipal): CaseScope | undefined {
  if (isTenantWideCaseRole(principal)) return undefined;
  return {
    assigneeId: principal.userId,
    types: caseTypesFor(principal),
    institutionIds: principal.institutionIds,
    areaIds: principal.areaIds,
  };
}

/** Is `entity` inside `scope`? Mirrors the SQL predicate used by the Pg repository. */
export function caseInScope(
  entity: Pick<CaseEntity, 'type' | 'institutionId' | 'areaId' | 'assignedTo'>,
  scope: CaseScope,
): boolean {
  if (entity.assignedTo !== null && entity.assignedTo === scope.assigneeId) return true;
  if (!scope.types.includes(entity.type)) return false;
  if (entity.institutionId !== null && scope.institutionIds.includes(entity.institutionId)) {
    return true;
  }
  return entity.areaId !== null && scope.areaIds.includes(entity.areaId);
}

export function canAccessCase(
  entity: Pick<CaseEntity, 'type' | 'institutionId' | 'areaId' | 'assignedTo'>,
  principal: CasePrincipal,
): boolean {
  const scope = caseScopeFor(principal);
  return scope === undefined || caseInScope(entity, scope);
}

function stringField(obj: object, key: string): string | null {
  const value: unknown = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Build the case principal from the authenticated `request.user` (gateway
 * `JwtPayload`). Returns null when no authenticated subject is present.
 */
export function getCasePrincipal(request: FastifyRequest): CasePrincipal | null {
  const user: unknown = (request as { user?: unknown }).user;
  if (user === null || typeof user !== 'object') return null;
  const userId = stringField(user, 'sub');
  if (!userId) return null;

  const roles = new Set<string>();
  const institutionIds = new Set<string>();
  const areaIds = new Set<string>();

  const rawRoles: unknown = (user as Record<string, unknown>)['roles'];
  if (Array.isArray(rawRoles)) {
    for (const role of rawRoles as unknown[]) {
      if (typeof role === 'string') {
        if (role.trim()) roles.add(role.trim());
        continue;
      }
      if (role === null || typeof role !== 'object') continue;
      const roleId = stringField(role, 'roleId');
      if (roleId) roles.add(roleId);
      const institutionId = stringField(role, 'institutionId');
      if (institutionId) institutionIds.add(institutionId);
    }
  }

  const rawInstitutions: unknown = (user as Record<string, unknown>)['institutions'];
  if (Array.isArray(rawInstitutions)) {
    for (const id of rawInstitutions as unknown[]) {
      if (typeof id === 'string' && id.trim()) institutionIds.add(id.trim());
    }
  }

  const rawAreas: unknown = (user as Record<string, unknown>)['areas'];
  if (Array.isArray(rawAreas)) {
    for (const area of rawAreas as unknown[]) {
      const id =
        typeof area === 'string'
          ? area.trim() || null
          : area !== null && typeof area === 'object'
            ? stringField(area, 'areaId')
            : null;
      if (id) areaIds.add(id);
    }
  }

  return {
    userId,
    roles: [...roles],
    institutionIds: [...institutionIds],
    areaIds: [...areaIds],
  };
}
