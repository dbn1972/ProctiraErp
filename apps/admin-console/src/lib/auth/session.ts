/**
 * Platform Admin session helpers.
 *
 * Decodes the access token cookie (without verifying the signature — that
 * happens upstream at the auth-service). Used to gate pages by role and to
 * forward the JWT on outbound API calls.
 */
import { decodeJwtPayload } from './jwt-payload';
import { platformRoleFromJwtRoles, type PlatformRole } from './roles';

/** JWT payload fields the admin console relies on. */
export interface AdminTokenPayload {
  sub: string;
  email: string;
  displayName?: string;
  /** Canonical role IDs emitted by the auth service. */
  roles?: unknown[];
  /** Functional role assigned to this operator. */
  platformRole?: PlatformRole;
  /**
   * Always 'platform' for admin-console tokens. The auth-service issues a
   * special tenantId='platform' for users who are platform operators.
   */
  tenantId: string;
  iat: number;
  exp: number;
}

/**
 * Decodes a JWT payload without signature verification.
 * Returns null on any structural failure.
 */
export function decodeAdminToken(token: string): AdminTokenPayload | null {
  // PRC-H112: shared base64url + UTF-8 decoder (same as middleware).
  const payload = decodeJwtPayload<AdminTokenPayload>(token);
  if (!payload) return null;

  return {
    ...payload,
    // H001: TokenService emits `roles`, not the console-only platformRole claim.
    // Prefer canonical role IDs whenever present; retain the legacy claim only
    // for older platform sessions that have no roles array. Roles are honoured
    // only on platform-tenant tokens: `super-admin` is also a tenant role ID, so a
    // tenant token must never be read as a platform operator.
    platformRole:
      payload.tenantId === 'platform'
        ? (platformRoleFromJwtRoles(payload.roles) ?? payload.platformRole)
        : undefined,
  };
}

/** Returns true when the access token is expired (with a 30s safety buffer). */
export function isAdminTokenExpired(token: string): boolean {
  const payload = decodeAdminToken(token);
  if (!payload || !payload.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp - 30 < now;
}
