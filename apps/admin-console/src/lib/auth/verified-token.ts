/**
 * PRC-L202: the console turns the `admin_access_token` cookie into claims
 * only through the shared JWKS verifier (`@proctira/auth`). With JWKS
 * configured (`KEYCLOAK_ISSUER` + `KEYCLOAK_CLIENT_ID`, optionally
 * `KEYCLOAK_AUDIENCE` / `KEYCLOAK_JWKS_URI`) a forged, unsigned or HMAC token
 * yields `null`; a deployed stage without JWKS config also yields `null`.
 * Local dev and CI keep decode-only parsing.
 *
 * A console session additionally requires the platform tenant: a verified
 * token for any other tenant is refused.
 */
import { verifyShellAccessToken, type VerifiedJwtClaims } from '@proctira/auth';

/** Tenant id the auth service issues to platform operators. */
export const PLATFORM_TENANT_ID = 'platform';

export interface ReadAdminTokenOptions {
  /** Return claims of an authentic but expired token (refresh path). */
  ignoreExpiry?: boolean;
}

/** Tenant claim (`tenantId` or Keycloak `tenant_id`; one value only). */
export function tenantClaim(claims: VerifiedJwtClaims): string | null {
  const raw = claims['tenantId'] ?? claims['tenant_id'];
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Verified claims of a platform-tenant token, or null when the token does
 * not verify or belongs to another tenant.
 */
export async function readPlatformToken(
  token: string,
  options: ReadAdminTokenOptions = {},
): Promise<VerifiedJwtClaims | null> {
  const result = await verifyShellAccessToken(token, process.env, {
    ignoreExpiry: options.ignoreExpiry,
  });
  if (!result.ok) return null;
  return tenantClaim(result.claims) === PLATFORM_TENANT_ID ? result.claims : null;
}
