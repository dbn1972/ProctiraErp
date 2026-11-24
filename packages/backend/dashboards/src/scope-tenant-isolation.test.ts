/**
 * D2 CORRECTION (PRC-M015): platform_admin is the cross-tenant control-plane operator and
 * does not get the tenant's unrestricted country dashboard. system_admin, the per-tenant
 * admin, keeps it.
 *
 * Failing-first: fails while platform_admin is in COUNTRY_ROLE_IDS, passes once it is removed.
 */
import type { JwtPayload, RoleAssignment } from '@proctira/auth';
import { describe, expect, it } from 'vitest';
import { canAccessVariant, deriveDashboardScope } from './scope.js';
function jwtFor(roles: RoleAssignment[]): JwtPayload {
  return {
    sub: 'user-1',
    tenantId: '00000000-0000-4000-8000-000000000001',
    email: 'user@example.com',
    displayName: 'Test User',
    roles,
    areas: [],
    institutions: [],
    iat: 0,
    exp: 9_999_999_999,
    jti: 'jti',
    sessionId: 'session',
  };
}
describe('dashboard scope tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED the country dashboard; system_admin keeps it', () => {
    const platform = deriveDashboardScope(
      jwtFor([{ roleId: 'platform_admin', roleName: 'Platform', areaId: 'country' }]),
    );
    expect(canAccessVariant(platform, 'country')).toBe(false);
    const system = deriveDashboardScope(
      jwtFor([{ roleId: 'system_admin', roleName: 'Sys', areaId: 'country' }]),
    );
    expect(canAccessVariant(system, 'country')).toBe(true);
  });
});
