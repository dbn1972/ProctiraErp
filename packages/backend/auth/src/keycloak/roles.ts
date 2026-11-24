import { DEFAULT_ROLES } from '@proctira/auth';
import type { RoleAssignment, RoleDefinition } from '@proctira/auth';

/**
 * Realm roles Keycloak manages for ProctiraERP.
 *
 * The first six are the original realm roles (unchanged, order-first). The
 * remaining canonical domain/government roles (D2 role-catalogue, PRC-M015)
 * were already gated on by backend module allow-lists but were silently
 * dropped by {@link mapKeycloakRoles} because they were absent from this
 * catalogue. Adding them here lets real Keycloak tokens carry the assignment
 * they already match in code — a privilege-*preserving* change relative to the
 * local/HS256-minted tokens those allow-lists were written for.
 */
export const KEYCLOAK_REALM_ROLES = [
  'super-admin',
  'admin',
  'principal',
  'teacher',
  'staff',
  'guardian',
  // --- D2 canonical additions (append-only; see packages/shared/auth rbac.ts) ---
  'platform_admin',
  'registrar',
  'bursar',
  'hr_officer',
  'staff_admin',
  'examinations_officer',
  'admissions_officer',
  'counsellor',
  'communications_officer',
  'notification_admin',
  'health_admin',
  'school_nurse',
  'nurse',
  'warden',
  'librarian',
  'finance_officer',
  'etl_engineer',
  'transport_officer',
  'timetable_officer',
  'subject_teacher',
  'class_teacher',
  'discipline_officer',
  'marks_clerk',
  'scholarship_officer',
  'board_admin',
  'board_officer',
  'board_regional_officer',
  'ministry_admin',
  'state_admin',
  'state_director',
  'parent',
  'student',
  'applicant',
] as const;

export type KeycloakRealmRole = (typeof KEYCLOAK_REALM_ROLES)[number];

const KNOWN_ROLES = new Set<string>(KEYCLOAK_REALM_ROLES);

/** A platform role a Keycloak realm or client role may map onto. */
export type KeycloakRoleCatalogEntry = Pick<RoleDefinition, 'roleId' | 'roleName'>;

const DEFAULT_ROLE_CATALOG: readonly KeycloakRoleCatalogEntry[] = DEFAULT_ROLES.filter((role) =>
  KNOWN_ROLES.has(role.roleId),
);

/**
 * Map Keycloak realm / client roles onto platform RoleAssignments.
 *
 * A role is kept only when `roleCatalog` defines it; everything else (Keycloak's
 * own offline_access / default-roles-*, IdP-only roles) is ignored. Without a
 * catalogue only the six realm roles are known. UATENV-D07: the gateway passes
 * its RBAC registry roles, so catalogue roles such as warden, bursar or student
 * are no longer dropped from Keycloak tokens.
 */
export function mapKeycloakRoles(
  keycloakRoles: readonly string[],
  options: {
    areaId?: string;
    institutionId?: string;
    roleCatalog?: readonly KeycloakRoleCatalogEntry[];
  } = {},
): RoleAssignment[] {
  const areaId = options.areaId ?? 'ROOT';
  const catalog = new Map<string, KeycloakRoleCatalogEntry>();
  for (const entry of options.roleCatalog ?? DEFAULT_ROLE_CATALOG) {
    catalog.set(entry.roleId.trim().toLowerCase(), entry);
  }
  const seen = new Set<string>();
  const assignments: RoleAssignment[] = [];

  for (const role of keycloakRoles) {
    const roleId = role.trim().toLowerCase();
    const definition = catalog.get(roleId);
    if (!definition || seen.has(roleId)) continue;
    seen.add(roleId);
    assignments.push({
      roleId,
      roleName: definition.roleName || roleId,
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
