/**
 * Maps JWT session claims (TokenPayload) into the client AuthUser shape
 * consumed by `<AuthProvider>` / `useAuth()`.
 *
 * Tokens stay httpOnly — this module never needs the raw string, only the
 * already-decoded payload from `getSession()` / `/api/auth/session`.
 */

import type { TokenPayload } from './session';

export type AuthScopeLevel = 'country' | 'state' | 'district' | 'board' | 'school';

export interface AuthUserScope {
  level: AuthScopeLevel;
  area_id?: string;
  board_id?: string;
  institution_id?: string;
}

export interface AuthUserFromToken {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  scope: AuthUserScope;
  tenant_id: string;
}

/** Normalises role identifiers (BOARD_ADMIN → board-admin). */
export function normaliseAuthRole(role: string): string {
  return role.toLowerCase().replace(/_/g, '-').trim();
}

/**
 * Extracts role ids from a JWT payload the same way middleware does
 * (`roleId` preferred, then `roleName`, then string entries).
 */
export function rolesFromTokenPayload(payload: TokenPayload): string[] {
  const ids: string[] = [];
  for (const role of payload.roles ?? []) {
    if (!role) continue;
    const raw = role.roleId || role.roleName || '';
    const normalised = normaliseAuthRole(raw);
    if (normalised) ids.push(normalised);
  }
  return ids;
}

/**
 * Derives a coarse UserScope for dashboard routing from role + area/institution
 * claims. Server RBAC remains authoritative; this is client UX only.
 */
export function scopeFromTokenPayload(payload: TokenPayload): AuthUserScope {
  const roles = rolesFromTokenPayload(payload);
  const areaId = payload.roles?.find((r) => r.areaId)?.areaId;
  const institutionId = payload.roles?.find((r) => r.institutionId)?.institutionId;

  const has = (...needles: string[]) =>
    roles.some((r) => needles.some((n) => r === n || r.includes(n)));

  if (has('country', 'ministry', 'national')) {
    return { level: 'country', ...(areaId ? { area_id: areaId } : {}) };
  }
  if (has('state', 'director')) {
    return { level: 'state', ...(areaId ? { area_id: areaId } : {}) };
  }
  if (has('district')) {
    return { level: 'district', ...(areaId ? { area_id: areaId } : {}) };
  }
  if (has('board-admin', 'board')) {
    return {
      level: 'board',
      ...(areaId ? { area_id: areaId, board_id: areaId } : {}),
    };
  }

  return {
    level: 'school',
    ...(areaId ? { area_id: areaId } : {}),
    ...(institutionId ? { institution_id: institutionId } : {}),
  };
}

/** Builds the AuthUser DTO from a verified/decoded session JWT payload. */
export function authUserFromTokenPayload(payload: TokenPayload): AuthUserFromToken {
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.displayName?.trim() || payload.email,
    roles: rolesFromTokenPayload(payload),
    permissions: [],
    scope: scopeFromTokenPayload(payload),
    tenant_id: payload.tenantId,
  };
}
