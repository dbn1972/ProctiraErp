/**
 * PRC-M027 / PRC-L298 — non-interactive credential principals.
 *
 * Root hooks in app.ts run before any encapsulated plugin hook, so both
 * strategies are a branch of the app.ts auth hook:
 *
 * - SCIM: on `/api/v1/scim/v2/*` the bearer must be a dedicated hashed SCIM
 *   token (scim-token-store.ts), never a JWT; an admin JWT gets 401 there. A
 *   SCIM token presented on another `/api/v1` route resolves to its principal
 *   and is refused by the RBAC allow-list (403).
 * - API keys (PRC-L298): a bearer with the developer-portal key shape
 *   (`oem_` + 32 hex) is resolved through the developer-portal key hash;
 *   revoked / expired keys get 401, and keys are never accepted on
 *   `/api/v1/auth/*`, `/api/v1/scim/*` or outside `/api/v1`.
 *
 * Both produce a synthetic principal `{ sub, tenantId, roles: [], credential,
 * iat }`. Everything after the auth hook (forgeable-header strip, tenantPlugin,
 * suspension / tenant-session revocation, RBAC + mutating inventory) runs
 * unchanged. In the RBAC hook {@link authorizeCredentialPrincipal} runs
 * immediately after the 401 check and before every early return (DR4-1):
 * credential principals never receive self-service, portal or platform-area
 * grants, and are allowed only what their fixed allow-list names.
 */
import type { PermissionAction } from '@proctira/backend-auth';
import { hashApiKey, PgApiKeyStore } from '@proctira/backend-developer-portal';
import { getSharedPgPool } from '@proctira/database';

import { evaluateExactMutatingAuthzGate, MUTATING_HTTP_METHODS } from './mutating-route-authz.js';
import { resourceForApiPath, UNMAPPED_API_RESOURCE } from './rbac-registry.js';
import { hashScimToken, isScimTokenShape, type ScimTokenStore } from './scim-token-store.js';

export type CredentialKind = 'scim' | 'apikey';

/** Synthetic `request.user` for a credential (no roles are ever derived). */
export interface CredentialPrincipal {
  sub: string;
  tenantId: string;
  roles: [];
  areas: [];
  institutions: [];
  credential: CredentialKind;
  /** Issue / rotation time in seconds (tenant-wide session revocation check). */
  iat: number;
  /** API-key scopes as stored (free-form strings; only table-mapped ones grant). */
  scopes?: string[];
}

/** Resolved API key (subset of the developer-portal ApiKeyEntity). */
export interface ApiKeyCredentialRecord {
  id: string;
  tenantId: string;
  status: string;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ApiKeyCredentialLookup {
  /** Resolve a raw `oem_` key (hashing is the lookup's job); null when unknown. */
  findByKey(rawKey: string): Promise<ApiKeyCredentialRecord | null>;
}

/** `{resource, read}` an API-key scope string grants. */
export interface ApiKeyScopeGrant {
  resource: string;
  action: 'read';
}

/**
 * PRC-L298: the shipped scope table is EMPTY. Scope strings are free-form on
 * the developer portal and no owner-approved vocabulary maps them to
 * resources yet, so a valid key authenticates and every resource answers 403
 * (equal to today's effective access: keys authenticated nothing). Not
 * env-configurable; widening it is a reviewed code change. Tests inject a
 * table through `buildApp({ credentialPrincipals: { apiKeyScopeTable } })`.
 */
export const SHIPPED_API_KEY_SCOPE_TABLE: Readonly<Record<string, ApiKeyScopeGrant>> =
  Object.freeze({});

/**
 * Resolved RBAC resources an API key can never reach, whatever a scope table
 * says (DR4-1: expressed in `resourceForApiPath` / inventory terms). `privacy`,
 * `audit-logs`, billing and tenant lifecycle resolve to `platform`; `tenant`
 * and `scim` resolve to `user`; workflow cases resolve to `case`.
 */
export const CREDENTIAL_HARD_DENY_RESOURCES: ReadonlySet<string> = new Set([
  'health',
  'case',
  'platform',
  'user',
  'fees',
  'staff',
  'billing-self',
]);

const SCIM_PATH_PREFIX = '/api/v1/scim/v2/';

export function isScimProvisioningPath(path: string): boolean {
  return path.startsWith(SCIM_PATH_PREFIX);
}

function isAuthOrScimPath(path: string): boolean {
  return (
    path === '/api/v1/auth' ||
    path.startsWith('/api/v1/auth/') ||
    path === '/api/v1/scim' ||
    path.startsWith('/api/v1/scim/')
  );
}

/** True when the bearer has the developer-portal API-key shape. */
export function isApiKeyBearer(bearer: string | undefined): bearer is string {
  return typeof bearer === 'string' && /^oem_[0-9a-f]{32}$/.test(bearer);
}

export type CredentialAuthOutcome =
  | { kind: 'not-applicable' }
  | { kind: 'unauthorized'; message: string }
  | { kind: 'principal'; principal: CredentialPrincipal };

const toSeconds = (value: Date | string): number => Math.floor(new Date(value).getTime() / 1000);

/**
 * Authenticate a credential bearer for `path`. `not-applicable` means the
 * normal JWT strategy handles the request.
 */
export async function authenticateCredential(input: {
  path: string;
  bearer: string | undefined;
  scimTokens: ScimTokenStore;
  scimPepper: string;
  apiKeys: ApiKeyCredentialLookup;
  now?: Date;
}): Promise<CredentialAuthOutcome> {
  const { path, bearer } = input;
  const scimPath = isScimProvisioningPath(path);
  const scimBearer = typeof bearer === 'string' && isScimTokenShape(bearer);
  // PRC-M027: a SCIM path never accepts a JWT (an admin session is not an IdP credential).
  if (scimPath && !scimBearer) {
    return { kind: 'unauthorized', message: 'A SCIM provisioning token is required' };
  }
  // A SCIM token presented elsewhere under /api/v1 still resolves to its
  // principal, so the RBAC allow-list answers 403 rather than a JWT 401.
  if (scimBearer && path.startsWith('/api/v1/')) {
    const record = await input.scimTokens.findByHash(hashScimToken(input.scimPepper, bearer));
    if (!record || record.status !== 'active') {
      return { kind: 'unauthorized', message: 'SCIM token is invalid or revoked' };
    }
    return {
      kind: 'principal',
      principal: {
        sub: `scim:${record.tokenId}`,
        tenantId: record.tenantId,
        roles: [],
        areas: [],
        institutions: [],
        credential: 'scim',
        iat: toSeconds(record.issuedAt),
      },
    };
  }
  if (!isApiKeyBearer(bearer)) return { kind: 'not-applicable' };
  // PRC-L298: API keys never authenticate the auth or SCIM surfaces, nor any
  // route outside /api/v1 (where the RBAC hook does not run).
  if (!path.startsWith('/api/v1/') || isAuthOrScimPath(path)) {
    return { kind: 'unauthorized', message: 'API keys are not accepted on this path' };
  }
  const key = await input.apiKeys.findByKey(bearer);
  const now = input.now ?? new Date();
  if (!key || key.status !== 'active' || (key.expiresAt && key.expiresAt <= now)) {
    return { kind: 'unauthorized', message: 'API key is invalid, revoked or expired' };
  }
  return {
    kind: 'principal',
    principal: {
      sub: `apikey:${key.id}`,
      tenantId: key.tenantId,
      roles: [],
      areas: [],
      institutions: [],
      credential: 'apikey',
      // Keys are replaced, not rotated: createdAt is the issue time.
      iat: toSeconds(key.createdAt),
      scopes: [...key.scopes],
    },
  };
}

/** The credential kind of a `request.user`, if it is a credential principal. */
export function credentialKindOf(user: unknown): CredentialKind | undefined {
  const kind = (user as { credential?: unknown } | null | undefined)?.credential;
  return kind === 'scim' || kind === 'apikey' ? kind : undefined;
}

/** rbac.ts semantics: `manage` covers every action. */
function grants(granted: PermissionAction, wanted: PermissionAction): boolean {
  return granted === 'manage' || granted === wanted;
}

export type CredentialAuthzDecision = { ok: true } | { ok: false; message: string };

/**
 * DR4-1: the complete gateway authorization of a credential principal. The
 * guard is resolved exactly as for users (inventory gate for mutations,
 * `resourceForApiPath` for reads); an undefined guard / resource or the
 * unmapped default is a deny. No self-service, portal or platform-area grant
 * applies.
 */
export function authorizeCredentialPrincipal(input: {
  principal: { credential: CredentialKind; scopes?: string[] };
  method: string;
  path: string;
  apiKeyScopeTable: Readonly<Record<string, ApiKeyScopeGrant>>;
}): CredentialAuthzDecision {
  const method = input.method.toUpperCase();
  let resource: string | undefined;
  let action: PermissionAction = 'read';
  if (MUTATING_HTTP_METHODS.has(method)) {
    const gate = evaluateExactMutatingAuthzGate({
      method,
      url: input.path,
      isPlatformAdmin: false,
    });
    if (!gate.ok || !gate.guard) {
      return { ok: false, message: 'No authorization guard covers this route for a credential' };
    }
    resource = gate.guard.resource;
    action = gate.guard.action;
  } else {
    resource = resourceForApiPath(input.path);
  }
  if (!resource || resource === UNMAPPED_API_RESOURCE) {
    return { ok: false, message: 'Credentials may not use this route' };
  }

  if (input.principal.credential === 'scim') {
    // PRC-M027: SCIM tokens hold {user: manage} on the SCIM surface only.
    if (isScimProvisioningPath(input.path) && resource === 'user' && grants('manage', action)) {
      return { ok: true };
    }
    return { ok: false, message: 'SCIM tokens may only call the SCIM provisioning API' };
  }

  // PRC-L298: API keys: read-only, never a hard-denied resource, and only
  // what a scope-table entry grants (unknown / unmapped scopes grant nothing).
  if (action !== 'read' || CREDENTIAL_HARD_DENY_RESOURCES.has(resource)) {
    return { ok: false, message: 'API keys may not perform this action' };
  }
  for (const scope of input.principal.scopes ?? []) {
    if (!Object.prototype.hasOwnProperty.call(input.apiKeyScopeTable, scope)) continue;
    const entry = input.apiKeyScopeTable[scope]!;
    if (entry.resource === resource && grants(entry.action, action)) return { ok: true };
  }
  return { ok: false, message: 'API key scopes do not grant this resource' };
}

/**
 * PRC-L298: default lookup through the developer-portal key table
 * (`getApiKeyByHash(hashApiKey(key))`, platform-scope hash lookup: the tenant
 * is the result, never an input). Without Postgres no key authenticates.
 */
export function createApiKeyCredentialLookup(): ApiKeyCredentialLookup {
  const pool = process.env['DATABASE_URL']?.trim() ? getSharedPgPool() : null;
  if (!pool) return { findByKey: async () => null };
  const store = new PgApiKeyStore(pool);
  return {
    async findByKey(rawKey) {
      const key = await store.getApiKeyByHash(hashApiKey(rawKey));
      return key
        ? {
            id: key.id,
            tenantId: key.tenantId,
            status: key.status,
            scopes: key.scopes,
            expiresAt: key.expiresAt,
            createdAt: key.createdAt,
          }
        : null;
    },
  };
}
