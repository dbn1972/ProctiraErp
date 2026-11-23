/**
 * PRC-L254: one place where the web BFF turns an access-token cookie into
 * claims. Used by the Edge middleware, server `getSession()` and the gateway
 * client.
 *
 * With JWKS configured (`KEYCLOAK_ISSUER` + `KEYCLOAK_CLIENT_ID`, optionally
 * `KEYCLOAK_AUDIENCE` / `KEYCLOAK_JWKS_URI`) the token's signature, issuer,
 * audience, `nbf` and (unless `ignoreExpiry`) `exp` are verified; a forged,
 * unsigned or HMAC token yields `null`. Without JWKS config a deployed stage
 * (`APP_ENV`/`DEPLOY_ENV` = staging/production) also yields `null` (fail
 * closed); local dev and CI keep decode-only parsing.
 */
import { verifyShellAccessToken, type VerifiedJwtClaims } from '@proctira/auth';

export type SessionTokenClaims = VerifiedJwtClaims;

export interface ReadSessionTokenOptions {
  /** Return claims of an authentic but expired token (for the refresh path). */
  ignoreExpiry?: boolean;
}

/** Verified (or, in decode-only mode, decoded) claims, or null when refused. */
export async function readSessionToken(
  token: string,
  options: ReadSessionTokenOptions = {},
): Promise<SessionTokenClaims | null> {
  const result = await verifyShellAccessToken(token, process.env, {
    ignoreExpiry: options.ignoreExpiry,
  });
  return result.ok ? result.claims : null;
}

/**
 * Tenant claim of a token: `tenantId` (gateway HS tokens) or `tenant_id`
 * (Keycloak mapper). A one-element array is read as its value; a
 * multi-valued or non-string claim is refused (PRC-L213 rule).
 */
export function tenantIdFromClaims(claims: SessionTokenClaims | null): string | null {
  if (!claims) return null;
  const raw = claims['tenantId'] ?? claims['tenant_id'];
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
