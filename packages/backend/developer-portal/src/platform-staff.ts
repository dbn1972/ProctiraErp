/**
 * PRC-H048 — platform-staff authorization for global marketplace moderation.
 *
 * Plugin review, marketplace publish and developer-docs mutations act on the
 * shared, cross-tenant marketplace/docs catalogue, so per-tenant RBAC (a
 * tenant admin holding `developer:*`) is not sufficient. Only platform staff
 * may perform them.
 *
 * The role set mirrors the gateway's canonical `PLATFORM_ADMIN_ROLE_IDS`
 * (`apps/api-gateway/src/rbac-registry.ts`). It is duplicated here because a
 * domain package cannot import from the gateway app; keep the two in sync.
 *
 * Matching uses `roleId` (or a bare string role) only — never `roleName`,
 * which is a display label and may be tenant-controlled.
 */
import type { FastifyRequest } from 'fastify';

/** Role IDs treated as platform staff (mirror of gateway PLATFORM_ADMIN_ROLE_IDS). */
export const PLATFORM_STAFF_ROLE_IDS: ReadonlySet<string> = new Set([
  'platform_admin',
  'super-admin',
]);

interface RequestUserLike {
  sub?: unknown;
  email?: unknown;
  tenantId?: unknown;
  roles?: unknown;
}

function requestUser(request: FastifyRequest): RequestUserLike | undefined {
  const user = (request as FastifyRequest & { user?: unknown }).user;
  return user && typeof user === 'object' ? (user as RequestUserLike) : undefined;
}

/** Extract role IDs from `request.user.roles` (strings or `{ roleId }` objects). */
export function roleIdsOf(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  const ids: string[] = [];
  for (const role of roles) {
    if (typeof role === 'string') {
      ids.push(role);
    } else if (role && typeof role === 'object') {
      const roleId = (role as { roleId?: unknown }).roleId;
      if (typeof roleId === 'string') ids.push(roleId);
    }
  }
  return ids;
}

/** True when the authenticated principal holds a platform-staff role ID. */
export function isPlatformStaff(request: FastifyRequest): boolean {
  const user = requestUser(request);
  if (!user) return false;
  return roleIdsOf(user.roles).some((id) => PLATFORM_STAFF_ROLE_IDS.has(id));
}

/** Authenticated principal email (lower-cased) when the auth plugin supplied one. */
export function authenticatedEmail(request: FastifyRequest): string | undefined {
  const email = requestUser(request)?.email;
  return typeof email === 'string' && email.length > 0 ? email.toLowerCase() : undefined;
}

/**
 * Tenant context of the caller: gateway-resolved `request.tenantId` first,
 * then the JWT claim. Headers are never consulted here.
 */
export function callerTenantId(request: FastifyRequest): string | undefined {
  const fromRequest = (request as FastifyRequest & { tenantId?: unknown }).tenantId;
  if (typeof fromRequest === 'string' && fromRequest.length > 0) return fromRequest;
  const fromUser = requestUser(request)?.tenantId;
  return typeof fromUser === 'string' && fromUser.length > 0 ? fromUser : undefined;
}

/** Standard 403 body for platform-staff-only routes. */
export const PLATFORM_STAFF_REQUIRED = {
  code: 'FORBIDDEN',
  message: 'Platform staff role required for marketplace moderation and developer docs',
  statusCode: 403,
} as const;
