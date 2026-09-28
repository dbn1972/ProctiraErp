/**
 * Platform Admin session helpers.
 *
 * Decodes the access token cookie (without verifying the signature — that
 * happens upstream at the auth-service). Used to gate pages by role and to
 * forward the JWT on outbound API calls.
 */
import { decodeJwtPayload } from '@proctira/common/jwt';

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
  // Delegates to `@proctira/common/jwt` for base64url- and UTF-8-correct
  // decoding; `atob()` alone rejects any token whose claims carry a non-Latin
  // name, which would silently log the operator out.
  return decodeJwtPayload<AdminTokenPayload>(token);
}

/** Returns true when the access token is expired (with a 30s safety buffer). */
export function isAdminTokenExpired(token: string): boolean {
  const payload = decodeAdminToken(token);
  if (!payload || !payload.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp - 30 < now;
}
