/**
 * Admissions grants for the registrar, shared by the gateway and web RBAC
 * registries (UATENV-D19, owner-delegated decision 2026-11-26: the registrar
 * reads the applications list and processes applications, with no fees or
 * finance access added).
 *
 * `packages/backend/registration/src/registration-access.ts` already lets the
 * registrar use admissions, but the gateway registry gave it only
 * `staff:manage`, so every /admissions and /registrations call returned 403.
 * Both `createGatewayRbacRegistry()` (apps/api-gateway) and
 * `createWebRbacRegistry()` (apps/web) apply {@link applyAdmissionsDomainRoleGrants},
 * so the gateway and the web route guards cannot drift.
 *
 * Least privilege, per gateway action (`actionForMethod`: GET read, POST
 * create, PUT/PATCH update; the registration API has no DELETE routes):
 * - registrar: `registration` read, list, create, update. No delete, manage,
 *   `*`, fees, finance, payroll or scholarship. The package guard still decides
 *   each admissions action after the gateway.
 *
 * {@link applyAdmissionsLookupReadGrants} is a separate, gateway-only grant:
 * `institution` read and list, so the admissions screens can resolve the
 * institution, academic period, grade and class names they need for interview
 * slots and placement. These are school structure, not personal data. The web
 * registry does not apply it, so the web keeps /institutions closed to the
 * registrar (web narrower than gateway fails closed).
 *
 * Every query stays scoped to the JWT tenant.
 */
import { applyDomainRoleGrants, type CampusDomainRoleGrant } from './campus-domain-roles.js';
import type { Permission, PermissionAction, RoleDefinition } from './rbac.js';

/** Roles that read and process admissions applications. */
export const ADMISSIONS_STAFF_ROLE_IDS = ['registrar'] as const;

const ADMISSIONS_ACTIONS: readonly PermissionAction[] = ['read', 'list', 'create', 'update'];
const LOOKUP_ACTIONS: readonly PermissionAction[] = ['read', 'list'];

const ROLE_NAMES: Record<string, string> = { registrar: 'Registrar' };

function permissions(resource: string, actions: readonly PermissionAction[]): Permission[] {
  return actions.map((action) => ({ resource, action }));
}

/** The admissions grant matrix, one entry per role id (gateway and web). */
export const ADMISSIONS_DOMAIN_ROLE_GRANTS: readonly CampusDomainRoleGrant[] =
  ADMISSIONS_STAFF_ROLE_IDS.map((roleId) => ({
    roleId,
    roleName: ROLE_NAMES[roleId]!,
    permissions: permissions('registration', ADMISSIONS_ACTIONS),
  }));

/** School-structure lookup reads the admissions screens need (gateway only). */
export const ADMISSIONS_LOOKUP_GRANTS: readonly CampusDomainRoleGrant[] =
  ADMISSIONS_STAFF_ROLE_IDS.map((roleId) => ({
    roleId,
    roleName: ROLE_NAMES[roleId]!,
    permissions: permissions('institution', LOOKUP_ACTIONS),
  }));

/**
 * Adds the admissions grants to `roles` in place and returns it. An existing
 * role keeps its permissions and gains the missing grants; an absent role is
 * added. Idempotent; permission objects are copied.
 */
export function applyAdmissionsDomainRoleGrants(roles: RoleDefinition[]): RoleDefinition[] {
  return applyDomainRoleGrants(roles, ADMISSIONS_DOMAIN_ROLE_GRANTS);
}

/** Adds the gateway-only institution lookup reads (see the module comment). */
export function applyAdmissionsLookupReadGrants(roles: RoleDefinition[]): RoleDefinition[] {
  return applyDomainRoleGrants(roles, ADMISSIONS_LOOKUP_GRANTS);
}
