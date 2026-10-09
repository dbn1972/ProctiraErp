import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

import type { JwtPayload } from '@proctira/auth';

import { extractKeycloakRoleNames, mapKeycloakRoles } from './roles.js';

export type KeycloakAuthConfig = {
  issuer: string;
  audience?: string;
  clientId: string;
  jwksUri: string;
  realm: string;
};

type Jwk = {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
};

type JwtHeader = { alg: string; kid?: string; typ?: string };

export type KeycloakAccessClaims = {
  sub: string;
  iss: string;
  exp: number;
  iat?: number;
  nbf?: number;
  aud?: string | string[];
  azp?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  tenant_id?: string | string[];
  tenantId?: string | string[];
  tenant_slug?: string | string[];
  tenantSlug?: string | string[];
  country?: string | string[];
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  roles?: string[];
  jti?: string;
  sid?: string;
};

/** Allowed clock skew for the `nbf` claim. */
const NBF_SKEW_SECONDS = 30;

export class KeycloakTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeycloakTokenError';
  }
}

export type KeycloakJwksClientOptions = {
  /** TTL for a successful JWKS fetch before a background refresh is allowed. */
  ttlMs?: number;
  /** Timeout applied to every JWKS network fetch. */
  fetchTimeoutMs?: number;
  /** Minimum interval between forced (unknown-kid) refreshes. */
  forcedRefreshCooldownMs?: number;
  /** How long an unknown kid is negatively cached before another refetch is attempted. */
  negativeCacheMs?: number;
};

/**
 * JWKS client hardened against unauthenticated amplification (PRC-M181,
 * NEW-g4_apps_auth-002):
 *   - every fetch has an AbortSignal timeout,
 *   - forced (unknown-kid) refreshes are rate-limited by a cooldown,
 *   - concurrent refreshes share a single in-flight promise (no stampede),
 *   - unknown kids are negatively cached so a flood of random kids cannot each
 *     trigger a network round-trip,
 *   - the new key map is built then swapped atomically so a concurrent getKey()
 *     never observes an empty map (no transient 401s for valid tokens).
 */
export class KeycloakJwksClient {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private lastForcedRefreshAt = 0;
  private inFlight: Promise<void> | null = null;
  private readonly negativeCache = new Map<string, number>();

  private readonly ttlMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly forcedRefreshCooldownMs: number;
  private readonly negativeCacheMs: number;

  constructor(
    private readonly jwksUri: string,
    private readonly fetcher: typeof fetch = fetch,
    options: KeycloakJwksClientOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 5_000;
    this.forcedRefreshCooldownMs = options.forcedRefreshCooldownMs ?? 30_000;
    this.negativeCacheMs = options.negativeCacheMs ?? 60_000;
  }

  async getKey(kid?: string): Promise<KeyObject> {
    await this.refreshIfNeeded();
    if (kid && this.keys.has(kid)) return this.keys.get(kid)!;
    if (!kid && this.keys.size === 1) return [...this.keys.values()][0]!;

    // Unknown kid. Only force a refetch if the kid has not been seen recently
    // AND the forced-refresh cooldown has elapsed; otherwise fail closed
    // without a network round-trip (prevents DoS amplification).
    if (kid && this.isNegativelyCached(kid)) {
      throw new KeycloakTokenError(`Unknown Keycloak signing key: ${kid}`);
    }
    const now = Date.now();
    if (now - this.lastForcedRefreshAt >= this.forcedRefreshCooldownMs) {
      await this.refreshIfNeeded(true);
      if (kid && this.keys.has(kid)) return this.keys.get(kid)!;
    }
    if (kid) this.negativeCache.set(kid, Date.now());
    throw new KeycloakTokenError(`Unknown Keycloak signing key${kid ? `: ${kid}` : ''}`);
  }

  private isNegativelyCached(kid: string): boolean {
    const seenAt = this.negativeCache.get(kid);
    if (seenAt === undefined) return false;
    if (Date.now() - seenAt >= this.negativeCacheMs) {
      this.negativeCache.delete(kid);
      return false;
    }
    return true;
  }

  private async refreshIfNeeded(force = false): Promise<void> {
    if (!force && this.keys.size > 0 && Date.now() - this.fetchedAt < this.ttlMs) return;
    // Coalesce concurrent refreshes into a single in-flight fetch.
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    if (force) this.lastForcedRefreshAt = Date.now();
    this.inFlight = this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async doRefresh(): Promise<void> {
    const signal = AbortSignal.timeout(this.fetchTimeoutMs);
    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await this.fetcher(this.jwksUri, { signal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new KeycloakTokenError(`Failed to load Keycloak JWKS: ${reason}`);
    }
    if (!response.ok) {
      throw new KeycloakTokenError(`Failed to load Keycloak JWKS (${response.status})`);
    }
    const body = (await response.json()) as { keys?: Jwk[] };
    // Build the new map first, then swap atomically so a concurrent getKey()
    // never sees a cleared map.
    const next = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue;
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      next.set(jwk.kid ?? `k${next.size}`, key);
    }
    this.keys = next;
    this.fetchedAt = Date.now();
    // A successful refresh may have introduced previously-unknown kids; drop
    // any negative-cache entries that are now resolvable.
    for (const kid of this.negativeCache.keys()) {
      if (next.has(kid)) this.negativeCache.delete(kid);
    }
  }
}

export function decodeJwt(token: string): {
  header: JwtHeader;
  payload: KeycloakAccessClaims;
  signed: string;
  signature: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new KeycloakTokenError('Malformed access token');
  }
  return {
    header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as JwtHeader,
    payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as KeycloakAccessClaims,
    signed: `${parts[0]}.${parts[1]}`,
    signature: parts[2],
  };
}

export function verifyRs256(signed: string, signature: string, key: KeyObject): boolean {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signed);
  verifier.end();
  return verifier.verify(key, signature, 'base64url');
}

export async function verifyKeycloakAccessToken(
  token: string,
  config: KeycloakAuthConfig,
  jwks: KeycloakJwksClient,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<JwtPayload> {
  const decoded = decodeJwt(token);
  if (decoded.header.alg !== 'RS256') {
    throw new KeycloakTokenError(`Unsupported Keycloak alg: ${decoded.header.alg}`);
  }
  const key = await jwks.getKey(decoded.header.kid);
  if (!verifyRs256(decoded.signed, decoded.signature, key)) {
    throw new KeycloakTokenError('Invalid Keycloak token signature');
  }

  const claims = decoded.payload;
  if (claims.iss !== config.issuer) {
    throw new KeycloakTokenError('Keycloak issuer mismatch');
  }
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    throw new KeycloakTokenError('Keycloak token expired');
  }
  if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + NBF_SKEW_SECONDS) {
    throw new KeycloakTokenError('Keycloak token not yet valid');
  }
  // PRC-M180: audience is always enforced. The token must either name the API
  // audience (KEYCLOAK_AUDIENCE, defaulting to the gateway client id) in `aud`
  // or have been issued to the gateway client itself (`azp`). A token minted
  // for any other client in the realm is rejected even with default config.
  const expectedAudience = config.audience?.trim() || config.clientId;
  if (!audienceIncludes(claims.aud, expectedAudience) && claims.azp !== config.clientId) {
    throw new KeycloakTokenError('Keycloak audience mismatch');
  }

  const tenantId = firstClaim(claims.tenant_id ?? claims.tenantId) ?? '';
  const roleNames = extractKeycloakRoleNames(claims, config.clientId);
  const displayName =
    claims.name ??
    [claims.given_name, claims.family_name].filter(Boolean).join(' ') ??
    claims.preferred_username ??
    claims.email ??
    claims.sub;

  return {
    sub: claims.sub || claims.preferred_username || claims.email || '',
    tenantId,
    email: claims.email ?? claims.preferred_username ?? '',
    displayName,
    roles: mapKeycloakRoles(roleNames),
    areas: tenantId ? [{ areaId: 'ROOT', level: 0 }] : [],
    institutions: [],
    iat: claims.iat ?? nowSeconds,
    exp: claims.exp,
    jti: claims.jti ?? claims.sub,
    sessionId: claims.sid ?? claims.jti ?? claims.sub,
  };
}

function firstClaim(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function audienceIncludes(aud: string | string[] | undefined, expected: string): boolean {
  if (!aud) return false;
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}

export function loadKeycloakAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): KeycloakAuthConfig | undefined {
  const issuer = env['KEYCLOAK_ISSUER'];
  const clientId = env['KEYCLOAK_CLIENT_ID'];
  if (!issuer || !clientId) return undefined;
  const realm = env['KEYCLOAK_REALM'] ?? 'proctira';
  return {
    issuer,
    clientId,
    realm,
    ...(env['KEYCLOAK_AUDIENCE']?.trim() ? { audience: env['KEYCLOAK_AUDIENCE'].trim() } : {}),
    jwksUri:
      env['KEYCLOAK_JWKS_URI'] ?? `${issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`,
  };
}
