/**
 * Plugin package in-package authorization guard.
 *
 * PRC-M603 / PRC-M627 — the plugin package is parked (not mounted behind the
 * gateway in `domain-plugins.ts`). Its routes nonetheless had no role check:
 * any authenticated caller could register, install, enable, disable or
 * uninstall a plugin. This module adds a fail-closed in-package guard that:
 *
 *   - requires a **platform admin** to register a plugin into the shared
 *     registry (a registry entry is platform-scoped, not tenant-scoped); and
 *   - requires a **tenant admin** (or platform admin) to install/enable/
 *     disable/uninstall a plugin for the current tenant.
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

/** Tenant/board admin role ids permitted to manage installs for their tenant. */
const TENANT_ADMIN_ROLE_IDS: ReadonlySet<string> = new Set(BOARD_TENANT_ADMIN_ROLE_IDS);

/**
 * Error raised when the caller lacks the role required for a plugin operation.
 * Routes translate this to HTTP 403.
 */
export class PluginForbiddenError extends Error {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';

  constructor(message: string) {
    super(message);
    this.name = 'PluginForbiddenError';
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
 * Fail-closed guard: only platform admins may register a plugin.
 * @throws PluginForbiddenError when the caller is not a platform admin.
 */
export function assertCanRegisterPlugin(request: FastifyRequest): void {
  if (!isPlatformAdmin(request)) {
    throw new PluginForbiddenError('Only a platform administrator may register a plugin');
  }
}

/**
 * Fail-closed guard: only tenant admins (or platform admins) may manage a
 * plugin installation (install/enable/disable/uninstall) for the current tenant.
 * @throws PluginForbiddenError when the caller is not a tenant or platform admin.
 */
export function assertCanManageInstallation(request: FastifyRequest): void {
  if (!isTenantAdmin(request)) {
    throw new PluginForbiddenError(
      'Only a tenant administrator may manage plugin installations for this tenant',
    );
  }
}
