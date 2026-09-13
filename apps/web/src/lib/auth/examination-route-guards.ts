/**
 * W1-SEC-02 (D5) — examination domain route authorization for the web app.
 */
import { hasPermission, type AuthUser } from '@proctira/auth';

import type { ServerSession } from '@/lib/auth/server';

import { getWebRbacRegistry } from './web-rbac-registry';

function sessionToAuthUser(session: ServerSession): AuthUser {
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

/** True when the session holds `examination.read` (or manage) via any role. */
export function sessionHasExaminationRead(session: ServerSession): boolean {
  return hasPermission(
    sessionToAuthUser(session),
    'examination',
    'read',
    getWebRbacRegistry(),
  );
}

/** Route-level gate for all `/examinations/*` dashboard pages and proxies. */
export function canAccessExaminationRoutes(session: ServerSession): boolean {
  return sessionHasExaminationRead(session);
}
