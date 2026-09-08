/**
 * Parent portal — JWT actor helpers (G-306).
 * Actor identity comes from HS256 JWT `sub` only; forgeable headers must be ignored.
 */
import { createSignedJwt } from './fake-session';

export const PARENT_PORTAL_TENANT_A = '00000000-0000-4000-8000-000000000001';
export const PARENT_PORTAL_TENANT_B = '00000000-0000-4000-8000-0000000000bb';
export const PARENT_PORTAL_STUDENT_ID = '00000000-0000-4000-8000-000000000099';

export function parentPortalJwtHeaders(
  sub: string,
  options: {
    tenantId?: string;
    roles?: Array<{ roleId: string; roleName: string; areaId: string | null }>;
    /** Forgeable headers — must never change server actor (G-102/G-306). */
    forgedActorHeaders?: Record<string, string>;
  } = {},
): Record<string, string> {
  const tenantId = options.tenantId ?? PARENT_PORTAL_TENANT_A;
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant.test`,
    displayName: sub,
    tenantId,
    roles: options.roles ?? [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
    ...(options.forgedActorHeaders ?? {}),
  };
}

export function studentPortalJwtHeaders(
  sub: string,
  tenantId: string = PARENT_PORTAL_TENANT_A,
): Record<string, string> {
  return parentPortalJwtHeaders(sub, {
    tenantId,
    roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
  });
}
