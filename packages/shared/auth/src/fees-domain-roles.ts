/**
 * Fees grants for the finance roles, shared by the gateway and web RBAC
 * registries (F-D3).
 *
 * `packages/backend/fees/src/fees-access.ts` lets these roles use the fee
 * ledger, but the gateway registry granted them nothing on `fees`, so every
 * /fees read returned 403 and only admin and principal could use the module.
 * Both `createGatewayRbacRegistry()` (apps/api-gateway) and
 * `createWebRbacRegistry()` (apps/web) apply this one matrix, so the gateway
 * and the web route guards cannot drift.
 *
 * Least privilege, per gateway action (`actionForMethod`: GET read, POST
 * create, DELETE delete; the fees API has no PUT/PATCH routes):
 * - finance_officer, bursar, accountant: fees read, list, create, delete. The
 *   package still decides each fees action after the gateway, so the
 *   accountant stays 403 on concession approval and scholarship netting
 *   (`concession.approve`).
 * - registrar (a records role): read and list, no writes, although the
 *   package would let it write.
 * No role gets `manage`, `*`, `update` or any other resource. Every query stays
 * scoped to the JWT tenant.
 */
import { applyDomainRoleGrants, type CampusDomainRoleGrant } from './campus-domain-roles.js';
import type { Permission, PermissionAction, RoleDefinition } from './rbac.js';

/** Finance roles that read and write the fee ledger (`fees-access.ts`). */
export const FEES_STAFF_ROLE_IDS = ['finance_officer', 'bursar', 'accountant'] as const;

/** Roles that may read, but not write, fees. */
export const FEES_READ_ONLY_ROLE_IDS = ['registrar'] as const;

/**
 * Built-in roles that hold the gateway's plain `fees:read` (gateway
 * STAFF_READS for teacher/staff, and the portal roles). The fees package
 * denies them every staff read, so they get no web grant; the web route guard
 * counts them as holding the gateway read only for the multi-role rule.
 * Pinned against the gateway registry by apps/api-gateway rbac-fees-roles.test.ts.
 */
export const FEES_BASE_READ_ROLE_IDS = [
  'teacher',
  'staff',
  'guardian',
  'parent',
  'student',
] as const;

const FEES_STAFF_ACTIONS: readonly PermissionAction[] = ['read', 'list', 'create', 'delete'];
const READ_ONLY_ACTIONS: readonly PermissionAction[] = ['read', 'list'];

const ROLE_NAMES: Record<string, string> = {
  finance_officer: 'Finance Officer',
  bursar: 'Bursar',
  accountant: 'Accountant',
  registrar: 'Registrar',
};

function feesPermissions(actions: readonly PermissionAction[]): Permission[] {
  return actions.map((action) => ({ resource: 'fees', action }));
}

/** The grant matrix, one entry per role id. */
export const FEES_DOMAIN_ROLE_GRANTS: readonly CampusDomainRoleGrant[] = [
  ...FEES_STAFF_ROLE_IDS.map((roleId) => ({
    roleId,
    roleName: ROLE_NAMES[roleId]!,
    permissions: feesPermissions(FEES_STAFF_ACTIONS),
  })),
  ...FEES_READ_ONLY_ROLE_IDS.map((roleId) => ({
    roleId,
    roleName: ROLE_NAMES[roleId]!,
    permissions: feesPermissions(READ_ONLY_ACTIONS),
  })),
];

/**
 * Adds the fees grants to `roles` in place and returns it. An existing role
 * (the gateway's `registrar`) keeps its permissions and gains the missing
 * grants; an absent role is added. Idempotent; permission objects are copied.
 */
export function applyFeesDomainRoleGrants(roles: RoleDefinition[]): RoleDefinition[] {
  return applyDomainRoleGrants(roles, FEES_DOMAIN_ROLE_GRANTS);
}
