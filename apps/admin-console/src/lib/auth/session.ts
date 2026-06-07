/**
 * Platform Admin session helpers.
 *
 * Decodes the access token cookie (without verifying the signature — that
 * happens upstream at the auth-service). Used to gate pages by role and to
 * forward the JWT on outbound API calls.
 */
import type { PlatformRole } from './roles';

/** JWT payload fields the admin console relies on. */
export interface AdminTokenPayload {
  sub: string;
  email: string;
  displayName?: string;
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
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const decoded = atob(parts[1]!);
    return JSON.parse(decoded) as AdminTokenPayload;
  } catch {
    return null;
  }
}

/** Returns true when the access token is expired (with a 30s safety buffer). */
export function isAdminTokenExpired(token: string): boolean {
  const payload = decodeAdminToken(token);
  if (!payload || !payload.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp - 30 < now;
}
