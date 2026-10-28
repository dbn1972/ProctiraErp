/**
 * PRC-M027 — non-interactive credential principals.
 *
 * Root hooks in app.ts run before any encapsulated plugin hook, so both
 * strategies are a branch of the app.ts auth hook:
 *
 * - SCIM: on `/api/v1/scim/v2/*` the bearer must be a dedicated hashed SCIM
 *   token (scim-token-store.ts), never a JWT; an admin JWT gets 401 there. A
 *   SCIM token presented on another `/api/v1` route resolves to its principal
 *   and is refused by the RBAC allow-list (403).
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

import { evaluateExactMutatingAuthzGate, MUTATING_HTTP_METHODS } from './mutating-route-authz.js';
import { resourceForApiPath, UNMAPPED_API_RESOURCE } from './rbac-registry.js';
import { hashScimToken, isScimTokenShape, type ScimTokenStore } from './scim-token-store.js';

export type CredentialKind = 'scim';

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
}

const SCIM_PATH_PREFIX = '/api/v1/scim/v2/';

export function isScimProvisioningPath(path: string): boolean {
  return path.startsWith(SCIM_PATH_PREFIX);
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
  return { kind: 'not-applicable' };
}

/** The credential kind of a `request.user`, if it is a credential principal. */
export function credentialKindOf(user: unknown): CredentialKind | undefined {
  const kind = (user as { credential?: unknown } | null | undefined)?.credential;
  return kind === 'scim' ? kind : undefined;
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
  principal: { credential: CredentialKind };
  method: string;
  path: string;
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

  // PRC-M027: SCIM tokens hold {user: manage} on the SCIM surface only.
  if (isScimProvisioningPath(input.path) && resource === 'user' && grants('manage', action)) {
    return { ok: true };
  }
  return { ok: false, message: 'SCIM tokens may only call the SCIM provisioning API' };
}
