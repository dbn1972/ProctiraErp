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
  aud?: string | string[];
  azp?: string;
  email?: string;
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

export class KeycloakTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeycloakTokenError';
  }
}

export class KeycloakJwksClient {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private readonly ttlMs = 10 * 60 * 1000;

  constructor(
    private readonly jwksUri: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getKey(kid?: string): Promise<KeyObject> {
    await this.refreshIfNeeded();
    if (kid && this.keys.has(kid)) return this.keys.get(kid)!;
    if (!kid && this.keys.size === 1) return [...this.keys.values()][0]!;
    await this.refreshIfNeeded(true);
    if (kid && this.keys.has(kid)) return this.keys.get(kid)!;
    throw new KeycloakTokenError(`Unknown Keycloak signing key${kid ? `: ${kid}` : ''}`);
  }

  private async refreshIfNeeded(force = false): Promise<void> {
    if (!force && this.keys.size > 0 && Date.now() - this.fetchedAt < this.ttlMs) return;
    const response = await this.fetcher(this.jwksUri);
    if (!response.ok) {
      throw new KeycloakTokenError(`Failed to load Keycloak JWKS (${response.status})`);
    }
    const body = (await response.json()) as { keys?: Jwk[] };
    this.keys.clear();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue;
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      this.keys.set(jwk.kid ?? `k${this.keys.size}`, key);
    }
    this.fetchedAt = Date.now();
  }
}

export function decodeJwt(token: string): { header: JwtHeader; payload: KeycloakAccessClaims; signed: string; signature: string } {
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
  if (config.audience && !audienceIncludes(claims.aud, config.audience) && claims.azp !== config.clientId) {
    throw new KeycloakTokenError('Keycloak audience mismatch');
  }

  const tenantId = firstClaim(claims.tenant_id ?? claims.tenantId) ?? '';
  const roleNames = extractKeycloakRoleNames(claims);
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
    audience: env['KEYCLOAK_AUDIENCE'],
    jwksUri: env['KEYCLOAK_JWKS_URI'] ?? `${issuer.replace(/\/$/, '')}/protocol/openid-connect/certs`,
  };
}
