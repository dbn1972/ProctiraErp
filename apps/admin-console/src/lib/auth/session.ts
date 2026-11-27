/**
 * Platform Admin session helpers.
 *
 * `decodeAdminToken` decodes without verification; the server session and the
 * middleware verify the token first (`./verified-token.ts`, PRC-L202) and map
 * the verified claims with `toAdminTokenPayload`. Used to gate pages by role
 * and to forward the JWT on outbound API calls.
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
  const decoded = decodeJwtPayload<AdminTokenPayload>(token);
  if (!decoded) return null;
  return toAdminTokenPayload(decoded);
}

/**
 * PRC-L202: maps (verified) claims to the console payload. Keycloak tokens
 * carry `tenant_id`; it is exposed as `tenantId`. A platform role is derived
 * only for platform-tenant tokens, from `roles` (TokenService) or from the
 * Keycloak realm/client roles (UATENV-D33).
 */
export function toAdminTokenPayload(claims: object): AdminTokenPayload {
  const raw = claims as AdminTokenPayload & { tenant_id?: unknown };
  const tenantRaw: unknown = raw.tenantId ?? raw.tenant_id;
  const tenantValue: unknown = Array.isArray(tenantRaw)
    ? tenantRaw.length === 1
      ? (tenantRaw[0] as unknown)
      : undefined
    : tenantRaw;
  const payload: AdminTokenPayload = {
    ...raw,
    tenantId: typeof tenantValue === 'string' ? tenantValue : '',
  };

  // Roles are honoured only on platform-tenant tokens: `super-admin` is also a
  // tenant role ID, so a tenant token must never be read as a platform operator.
  if (payload.tenantId !== 'platform') return { ...payload, platformRole: undefined };

  const record = claims as Record<string, unknown>;
  if (isKeycloakClaims(record)) {
    // UATENV-D33: a Keycloak token carries roles in `realm_access.roles` and
    // `resource_access[azp].roles`, not in a top-level `roles` claim. As in the
    // gateway (PRC-M178), the unpinned top-level `roles`/`platformRole` claims
    // of a Keycloak token grant nothing.
    return { ...payload, platformRole: platformRoleFromJwtRoles(keycloakRoleNames(record)) };
  }

  return {
    ...payload,
    // H001: TokenService emits `roles`, not the console-only platformRole claim.
    // Prefer canonical role IDs whenever present; retain the legacy claim only
    // for older platform sessions that have no roles array.
    platformRole: platformRoleFromJwtRoles(payload.roles) ?? payload.platformRole,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True for a Keycloak-shaped payload: the platform TokenService shape is a
 * `roles` array with a string `tenantId`; Keycloak tokens carry
 * `realm_access`/`resource_access` or the `tenant_id` mapper claim. Same rule
 * as the web app (`apps/web/src/lib/auth/token-claims.ts`).
 */
function isKeycloakClaims(raw: Record<string, unknown>): boolean {
  if (Array.isArray(raw['roles']) && typeof raw['tenantId'] === 'string') return false;
  return (
    isRecord(raw['realm_access']) ||
    isRecord(raw['resource_access']) ||
    raw['tenant_id'] !== undefined
  );
}

/** Realm roles plus the client roles issued for this token's own client (`azp`). */
function keycloakRoleNames(raw: Record<string, unknown>): string[] {
  const names = new Set<string>();
  const realm = raw['realm_access'];
  if (isRecord(realm) && Array.isArray(realm['roles'])) {
    for (const role of realm['roles']) if (typeof role === 'string') names.add(role);
  }
  const clientId = typeof raw['azp'] === 'string' ? raw['azp'] : undefined;
  const access = raw['resource_access'];
  if (clientId && isRecord(access) && Object.prototype.hasOwnProperty.call(access, clientId)) {
    const client = access[clientId];
    if (isRecord(client) && Array.isArray(client['roles'])) {
      for (const role of client['roles']) if (typeof role === 'string') names.add(role);
    }
  }
  return [...names];
}

/** Returns true when the access token is expired (with a 30s safety buffer). */
export function isAdminTokenExpired(token: string): boolean {
  const payload = decodeAdminToken(token);
  if (!payload || !payload.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp - 30 < now;
}
