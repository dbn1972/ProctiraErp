/**
 * Policy package in-package authorization guard.
 *
 * PRC-M606 / PRC-M609 / PRC-M630 — the policy package is parked (not mounted
 * behind the gateway in `domain-plugins.ts`). Its routes nonetheless had no
 * role check: any authenticated caller in a tenant could create, update,
 * activate, deactivate, assign or un-assign a policy. This module adds a
 * fail-closed in-package guard that requires a **tenant admin** (or a platform
 * admin) to mutate a policy for the current tenant.
 *
 * PRC-M610 — a policy carries a `scope` of `platform | tenant | institution`.
 * A `platform`-scope policy applies across every tenant through the evaluation
 * inheritance chain, so only a **platform admin** may author (create or update
 * into) a `platform`-scope policy, or assign a policy to the `platform` target.
 * A tenant admin attempting either is rejected. This stops a single tenant from
 * writing policy that would leak across the whole platform.
 *
 * Role ids come from the canonical shared sets in `@proctira/common` so a
 * parked package can never widen who counts as an admin. Matching is exact on
 * the role id (no case-folding, no tenant-editable display-name fallback). The
 * guard reads roles only from the verified `request.user` the gateway attaches;
 * it never trusts a body/header/query value. No new package dependency is added.
 */
import {
  BOARD_TENANT_ADMIN_ROLE_IDS,
  hasPlatformAdminRole,
  principalRoleIds,
} from '@proctira/common';
import type { FastifyRequest } from 'fastify';

/** Tenant/board admin role ids permitted to manage policies for their tenant. */
const TENANT_ADMIN_ROLE_IDS: ReadonlySet<string> = new Set(BOARD_TENANT_ADMIN_ROLE_IDS);

/**
 * Error raised when the caller lacks the role required for a policy operation.
 * Routes translate this to HTTP 403.
 */
export class PolicyForbiddenError extends Error {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';

  constructor(message: string) {
    super(message);
    this.name = 'PolicyForbiddenError';
  }
}

function principal(request: FastifyRequest): { roles?: unknown } {
  return (request as FastifyRequest & { user?: { roles?: unknown } }).user ?? {};
}

/** True when the verified principal carries a platform-admin role id. */
export function isPlatformAdmin(request: FastifyRequest): boolean {
  return hasPlatformAdminRole(principal(request).roles);
}

/** True when the verified principal carries a tenant-admin (or platform-admin) role id. */
export function isTenantAdmin(request: FastifyRequest): boolean {
  if (isPlatformAdmin(request)) return true;
  return principalRoleIds(principal(request)).some((id) => TENANT_ADMIN_ROLE_IDS.has(id));
}

/**
 * Fail-closed guard: only tenant admins (or platform admins) may mutate a
 * policy (create/update/activate/deactivate/assign/removeAssignment) for the
 * current tenant.
 * @throws PolicyForbiddenError when the caller is not a tenant or platform admin.
 */
export function assertCanManagePolicy(request: FastifyRequest): void {
  if (!isTenantAdmin(request)) {
    throw new PolicyForbiddenError(
      'Only a tenant administrator may manage policies for this tenant',
    );
  }
}

/**
 * Fail-closed guard for platform-scope authorship (PRC-M610): only platform
 * admins may create or update a policy whose scope is `platform`, or assign a
 * policy to the `platform` target. A tenant admin is rejected.
 *
 * @param request the verified request.
 * @param scope the policy/assignment scope under consideration; the guard only
 *   restricts `'platform'`. `tenant`/`institution` pass through (they are still
 *   subject to {@link assertCanManagePolicy}).
 * @throws PolicyForbiddenError when `scope === 'platform'` and the caller is not
 *   a platform admin.
 */
export function assertCanAuthorScope(
  request: FastifyRequest,
  scope: 'platform' | 'tenant' | 'institution',
): void {
  if (scope === 'platform' && !isPlatformAdmin(request)) {
    throw new PolicyForbiddenError(
      'Only a platform administrator may author a platform-scope policy',
    );
  }
}
