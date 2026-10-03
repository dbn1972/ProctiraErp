import { DEFAULT_ROLES } from '@proctira/auth';
import type { RoleAssignment, RoleDefinition } from '@proctira/auth';

/** Realm roles Keycloak manages for ProctiraERP. */
export const KEYCLOAK_REALM_ROLES = [
  'super-admin',
  'admin',
  'principal',
  'teacher',
  'staff',
  'guardian',
] as const;

export type KeycloakRealmRole = (typeof KEYCLOAK_REALM_ROLES)[number];

const KNOWN_ROLES = new Set<string>(KEYCLOAK_REALM_ROLES);

/**
 * Map Keycloak realm / client roles onto platform RoleAssignments.
 * Unknown roles are ignored so Keycloak can hold extra IdP-only roles.
 */
export function mapKeycloakRoles(
  keycloakRoles: readonly string[],
  options: { areaId?: string; institutionId?: string } = {},
): RoleAssignment[] {
  const areaId = options.areaId ?? 'ROOT';
  const seen = new Set<string>();
  const assignments: RoleAssignment[] = [];

  for (const role of keycloakRoles) {
    const roleId = role.trim().toLowerCase();
    if (!KNOWN_ROLES.has(roleId) || seen.has(roleId)) continue;
    seen.add(roleId);
    const definition = DEFAULT_ROLES.find((item) => item.roleId === roleId);
    assignments.push({
      roleId,
      roleName: definition?.roleName ?? roleId,
      areaId,
      ...(options.institutionId ? { institutionId: options.institutionId } : {}),
    });
  }

  return assignments;
}

/**
 * PRC-M178: only trust realm roles (`realm_access.roles`) and client roles issued
 * for *this* gateway client (`resource_access[clientId].roles`). Roles granted on
 * other clients in the realm and the unpinned top-level `roles` claim are ignored
 * so that e.g. `resource_access['other-app'].roles=['super-admin']` grants nothing.
 */
export function extractKeycloakRoleNames(
  payload: {
    realm_access?: { roles?: string[] };
    resource_access?: Record<string, { roles?: string[] }>;
    roles?: string[];
  },
  clientId?: string,
): string[] {
  const names = new Set<string>();
  for (const role of payload.realm_access?.roles ?? []) names.add(role);
  if (clientId) {
    const access = payload.resource_access ?? {};
    const client = Object.prototype.hasOwnProperty.call(access, clientId)
      ? access[clientId]
      : undefined;
    for (const role of client?.roles ?? []) names.add(role);
  }
  return [...names];
}

export function keycloakRoleCatalog(): RoleDefinition[] {
  return DEFAULT_ROLES.filter((role) => KNOWN_ROLES.has(role.roleId));
}
