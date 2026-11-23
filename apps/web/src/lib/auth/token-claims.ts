/**
 * UATENV-D06: one place that turns a decoded access-token payload into the
 * platform claim shape the web uses (`tenantId`, `roles[].roleId`, ...).
 *
 * Platform (HS-JWT) tokens already carry `tenantId` and `roles: [{ roleId }]`.
 * Keycloak tokens, which the web stores as-is after the OIDC login, carry
 * `tenant_id` and `realm_access.roles` / `resource_access[client].roles`
 * instead, so before this the web saw a Keycloak session with no roles and no
 * tenant: the nav showed only Dashboard, every role-guarded page failed and
 * the portal bounce never fired.
 *
 * Keycloak roles are read the way the gateway reads them (PRC-M178): realm
 * roles plus client roles of the client the token was issued to (`azp`); the
 * unpinned top-level `roles` claim and other clients' roles are ignored.
 * Keycloak's own roles (offline_access, uma_authorization, default-roles-*)
 * are dropped so they never count as a staff role.
 *
 * Edge/Node/browser-safe (used by middleware). Claims are for UX gating only;
 * the gateway verifies every token and is the authorization enforcement point.
 */

export interface TokenClaimRole {
  roleId: string;
  roleName: string;
  areaId: string;
  institutionId?: string;
}

export interface NormalisedTokenClaims {
  sub: string;
  /** Empty when the token carries no tenant claim. */
  tenantId: string;
  email: string;
  displayName?: string;
  sessionId?: string;
  roles: TokenClaimRole[];
  iat: number;
  exp: number;
  /** Set for Keycloak-issued tokens, whose `sub` is the Keycloak subject. */
  idp?: 'keycloak';
}

const KEYCLOAK_BUILT_IN_ROLES: ReadonlySet<string> = new Set([
  'offline_access',
  'uma_authorization',
]);

type Claims = Record<string, unknown>;

function isRecord(value: unknown): value is Claims {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function firstStr(value: unknown): string | undefined {
  return Array.isArray(value) ? str(value[0]) : str(value);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** True for a Keycloak-shaped payload (no platform `roles`/`tenantId`, Keycloak claims present). */
export function isKeycloakClaims(raw: Claims): boolean {
  if (Array.isArray(raw['roles']) && typeof raw['tenantId'] === 'string') return false;
  return (
    isRecord(raw['realm_access']) ||
    isRecord(raw['resource_access']) ||
    raw['tenant_id'] !== undefined
  );
}

function keycloakRoleNames(raw: Claims): string[] {
  const names = new Set<string>();
  const realm = raw['realm_access'];
  if (isRecord(realm) && Array.isArray(realm['roles'])) {
    for (const role of realm['roles']) if (typeof role === 'string') names.add(role);
  }
  const clientId = str(raw['azp']);
  const access = raw['resource_access'];
  if (clientId && isRecord(access) && Object.prototype.hasOwnProperty.call(access, clientId)) {
    const client = access[clientId];
    if (isRecord(client) && Array.isArray(client['roles'])) {
      for (const role of client['roles']) if (typeof role === 'string') names.add(role);
    }
  }
  return [...names];
}

function isKeycloakBuiltInRole(roleId: string): boolean {
  return KEYCLOAK_BUILT_IN_ROLES.has(roleId) || roleId.startsWith('default-roles-');
}

function platformRoles(value: unknown): TokenClaimRole[] {
  if (!Array.isArray(value)) return [];
  const roles: TokenClaimRole[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      if (entry.trim()) roles.push({ roleId: entry, roleName: entry, areaId: 'ROOT' });
      continue;
    }
    if (!isRecord(entry)) continue;
    const roleId = str(entry['roleId']) ?? str(entry['roleName']) ?? str(entry['id']);
    if (!roleId) continue;
    const institutionId = str(entry['institutionId']);
    roles.push({
      roleId,
      roleName: str(entry['roleName']) ?? roleId,
      areaId: str(entry['areaId']) ?? 'ROOT',
      ...(institutionId ? { institutionId } : {}),
    });
  }
  return roles;
}

/** Normalises a decoded access-token payload (platform or Keycloak). */
export function normaliseTokenClaims(raw: Claims): NormalisedTokenClaims {
  const iat = num(raw['iat']);
  const exp = num(raw['exp']);
  if (!isKeycloakClaims(raw)) {
    const displayName = str(raw['displayName']);
    const sessionId = str(raw['sessionId']);
    return {
      sub: str(raw['sub']) ?? '',
      tenantId: str(raw['tenantId']) ?? '',
      email: str(raw['email']) ?? '',
      ...(displayName ? { displayName } : {}),
      ...(sessionId ? { sessionId } : {}),
      roles: platformRoles(raw['roles']),
      iat,
      exp,
    };
  }

  const seen = new Set<string>();
  const roles: TokenClaimRole[] = [];
  for (const name of keycloakRoleNames(raw)) {
    const roleId = name.trim().toLowerCase();
    if (!roleId || isKeycloakBuiltInRole(roleId) || seen.has(roleId)) continue;
    seen.add(roleId);
    roles.push({ roleId, roleName: roleId, areaId: 'ROOT' });
  }
  const fullName = [str(raw['given_name']), str(raw['family_name'])].filter(Boolean).join(' ');
  const displayName = str(raw['name']) ?? (fullName || undefined) ?? str(raw['preferred_username']);
  const sessionId = str(raw['sid']);
  return {
    sub: str(raw['sub']) ?? '',
    tenantId: firstStr(raw['tenant_id']) ?? firstStr(raw['tenantId']) ?? '',
    email: str(raw['email']) ?? str(raw['preferred_username']) ?? '',
    ...(displayName ? { displayName } : {}),
    ...(sessionId ? { sessionId } : {}),
    roles,
    iat,
    exp,
    idp: 'keycloak',
  };
}
