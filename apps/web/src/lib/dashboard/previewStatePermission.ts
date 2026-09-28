/**
 * Shared `dashboard-preview:manage` permission check (Task 9.1,
 * `principal-dashboard-parity`).
 *
 * Two call sites need the identical "does this session's *actual* roles
 * carry `dashboard-preview:manage`" decision:
 *   - `resolvePreviewOverride()` (Task 7.2, `./resolvePreviewOverride.ts`) —
 *     the read-side gate the dashboard page consults on every render.
 *   - The preview-state set/clear routes (Task 9.1,
 *     `apps/web/src/app/api/dashboard/preview-state/route.ts`) — the
 *     write-side gate for actually forcing/clearing a preview state.
 *
 * Both must never trust a cookie's presence, or any client-side visibility
 * flag, as a substitute for this check (Req 6 AC12, Req 7 AC4). This module
 * exists so the session→`AuthUser` mapping and the permission check itself
 * are defined exactly once rather than duplicated a third time across the
 * two call sites above (the mapping already appears once more, independently,
 * in `apps/web/src/lib/auth/examination-route-guards.ts` for a different
 * permission — that duplication predates this module and is out of scope
 * here).
 */
import { hasPermission, type AuthUser } from '@proctira/auth';

import type { ServerSession } from '@/lib/auth/server';
import { getWebRbacRegistry } from '@/lib/auth/web-rbac-registry';

/**
 * Maps the web app's session claims (`TokenPayload.roles`) into the
 * `AuthUser`/`RoleAssignment[]` shape `hasPermission` expects (roleId
 * lowercased defensively — JWT role ids are not guaranteed to arrive in the
 * same casing as the `DEFAULT_ROLES` catalogue keys).
 */
export function sessionToAuthUser(session: ServerSession): AuthUser {
  const { user } = session;
  return {
    userId: user.sub,
    tenantId: user.tenantId,
    email: user.email,
    displayName: user.displayName ?? user.email,
    roles: user.roles.map((role) => ({
      roleId: role.roleId.toLowerCase(),
      roleName: role.roleName,
      areaId: role.areaId,
      institutionId: role.institutionId,
    })),
    areas: [],
    institutions: [],
  };
}

/**
 * True when the session's actual roles carry `dashboard-preview:manage` in
 * the web RBAC registry.
 *
 * This does not look at the preview cookie, expiry, or `session.isExpired`
 * at all — callers own those checks themselves (e.g. `resolvePreviewOverride`
 * composes this with its own cookie+expiry checks; the set/clear routes
 * compose it with their own `session.isExpired` check) so this function
 * stays a single-purpose permission decision.
 */
export function hasDashboardPreviewPermission(session: ServerSession): boolean {
  return hasPermission(
    sessionToAuthUser(session),
    'dashboard-preview',
    'manage',
    getWebRbacRegistry(),
  );
}
