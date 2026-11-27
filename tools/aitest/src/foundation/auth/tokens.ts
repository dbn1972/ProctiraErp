/**
 * HS256 principals the gateway accepts in local-JWT mode (program plan D8):
 * iss proctira-platform, aud proctira-api, claims sub/tenantId/email/
 * displayName/roles[{roleId, roleName, areaId}]/areas/institutions/jti/
 * sessionId, signed with the stack's JWT_SECRET (same shape as
 * apps/web/e2e/fixtures/fake-session.ts createSignedJwt). MintOptions also
 * produce deliberately broken tokens for security probing.
 */
import { createHmac, randomUUID } from 'node:crypto';

import type { FixtureManifest } from '../seed/fixtures.js';
import { TENANTS, type TenantKey } from '../seed/tenants.js';

import { PLATFORM_TENANT, PORTAL_ROLES } from './roles.js';

export interface Principal {
  sub: string;
  tenantId: string;
  roles: string[];
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
  /** Institution ids the user may access (AuthUser.institutions). */
  institutions?: string[];
  areas?: Array<{ areaId: string; level: number }>;
  jti?: string;
  sessionId?: string;
  extraClaims?: Record<string, unknown>;
}

export interface MintOptions {
  secret?: string;
  alg?: 'HS256' | 'HS384' | 'HS512' | 'none';
  expiresInSec?: number;
  issuedAtSec?: number;
  notBeforeSec?: number;
  issuer?: string;
  audience?: string;
  /** Merged into the JOSE header. */
  header?: Record<string, unknown>;
  /** 'strip' = empty signature segment, 'garble' = flipped signature. */
  signature?: 'valid' | 'strip' | 'garble';
}

export const DEFAULT_ISSUER = 'proctira-platform';
export const DEFAULT_AUDIENCE = 'proctira-api';
const HMAC: Record<'HS256' | 'HS384' | 'HS512', string> = {
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512',
};

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

export function principalClaims(p: Principal): Record<string, unknown> {
  return {
    sub: p.sub,
    tenantId: p.tenantId,
    email: p.email ?? `${p.sub}@proctira-aitest.test`,
    displayName: p.displayName ?? p.sub,
    ...(p.emailVerified !== undefined ? { emailVerified: p.emailVerified } : {}),
    roles: p.roles.map((roleId) => ({ roleId, roleName: roleId, areaId: null })),
    areas: p.areas ?? [],
    institutions: p.institutions ?? [],
    jti: p.jti ?? randomUUID(),
    sessionId: p.sessionId ?? `aitest-${randomUUID()}`,
    ...p.extraClaims,
  };
}

export function mintToken(p: Principal, o: MintOptions = {}): string {
  const alg = o.alg ?? 'HS256';
  const secret = o.secret ?? process.env['AITEST_JWT_SECRET'];
  if (alg !== 'none' && !secret) throw new Error('mintToken needs a secret (stack JWT_SECRET)');
  const iat = o.issuedAtSec ?? Math.floor(Date.now() / 1000);
  const body = {
    iss: o.issuer ?? DEFAULT_ISSUER,
    aud: o.audience ?? DEFAULT_AUDIENCE,
    iat,
    exp: iat + (o.expiresInSec ?? 8 * 60 * 60),
    ...(o.notBeforeSec !== undefined ? { nbf: o.notBeforeSec } : {}),
    ...principalClaims(p),
  };
  const head = b64({ alg, typ: 'JWT', ...o.header });
  const payload = b64(body);
  if (alg === 'none' || o.signature === 'strip') return `${head}.${payload}.`;
  let sig = createHmac(HMAC[alg], secret ?? '')
    .update(`${head}.${payload}`)
    .digest('base64url');
  if (o.signature === 'garble') {
    sig = `${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
  }
  return `${head}.${payload}.${sig}`;
}

/** Decodes a JWT without verifying it (tests and reports only). */
export function decodeToken(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const [h, p] = token.split('.');
  const parse = (s: string | undefined) =>
    JSON.parse(Buffer.from(s ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  return { header: parse(h), payload: parse(p) };
}

export type TokenTenant = TenantKey | typeof PLATFORM_TENANT;

export interface TokenFactory {
  /** Portal roles (guardian/parent/student) get a seeded sub from the fixture manifest. */
  principal(
    role: string,
    tenant: TokenTenant,
    o?: { sub?: string; institutions?: 'none' | 'all' | string[] },
  ): Principal;
  token(role: string, tenant: TokenTenant, o?: MintOptions & { sub?: string }): string;
  /** authorization + x-tenant-id. */
  headers(role: string, tenant: TokenTenant, o?: { tenantHeader?: string }): Record<string, string>;
  sessionCookies(
    token: string,
    baseUrl: string,
  ): Array<{ name: 'access_token' | 'refresh_token'; value: string; url: string }>;
  mint(p: Principal, o?: MintOptions): string;
}

export function tenantIdFor(tenant: TokenTenant): string {
  return tenant === PLATFORM_TENANT ? PLATFORM_TENANT : TENANTS[tenant].id;
}

export function createTokenFactory(secret: string, fixtures?: FixtureManifest): TokenFactory {
  const portalSub = (role: string, tenant: TokenTenant): string | undefined => {
    if (!fixtures || tenant === PLATFORM_TENANT) return undefined;
    if (role === 'student') return fixtures.principals.students[tenant]?.[0]?.sub;
    if (role === 'guardian' || role === 'parent') return fixtures.principals.guardians[tenant]?.[0];
    return undefined;
  };
  const f: TokenFactory = {
    principal(role, tenant, o = {}) {
      const sub =
        o.sub ??
        (PORTAL_ROLES.has(role) ? portalSub(role, tenant) : undefined) ??
        `aitest-${role.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${tenant.toLowerCase()}`;
      let institutions: string[] | undefined;
      if (Array.isArray(o.institutions)) institutions = o.institutions;
      else if (o.institutions === 'all' && fixtures && tenant !== PLATFORM_TENANT) {
        institutions = fixtures.tenants[tenant].institutions;
      } else if (o.institutions === 'none') institutions = [];
      return {
        sub,
        tenantId: tenantIdFor(tenant),
        roles: [role],
        displayName: `aitest ${role}`,
        ...(institutions ? { institutions } : {}),
      };
    },
    token(role, tenant, o = {}) {
      const { sub, ...mint } = o;
      return f.mint(f.principal(role, tenant, sub ? { sub } : {}), mint);
    },
    headers(role, tenant, o = {}) {
      return {
        authorization: `Bearer ${f.token(role, tenant)}`,
        'x-tenant-id': o.tenantHeader ?? tenantIdFor(tenant),
      };
    },
    sessionCookies(token, baseUrl) {
      return [
        { name: 'access_token', value: token, url: baseUrl },
        { name: 'refresh_token', value: token, url: baseUrl },
      ];
    },
    mint(p, o = {}) {
      return mintToken(p, { secret, ...o });
    },
  };
  return f;
}
