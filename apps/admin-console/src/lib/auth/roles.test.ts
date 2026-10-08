import { describe, expect, it } from 'vitest';

import { AREA_ROLES, hasRole, platformRoleFromJwtRoles, type PlatformRole } from './roles';

describe('hasRole', () => {
  it('denies missing role', () => {
    expect(hasRole(undefined, 'tenants')).toBe(false);
  });

  it('allows platform_admin in every area', () => {
    for (const area of Object.keys(AREA_ROLES) as (keyof typeof AREA_ROLES)[]) {
      expect(hasRole('platform_admin', area)).toBe(true);
    }
  });

  it('allows billing only for tenants and plans', () => {
    expect(hasRole('billing', 'tenants')).toBe(true);
    expect(hasRole('billing', 'plans')).toBe(true);
    expect(hasRole('billing', 'plugins')).toBe(false);
    expect(hasRole('billing', 'breakGlassApprove')).toBe(false);
  });

  it('allows security for plugins, themes, and break-glass approve', () => {
    expect(hasRole('security', 'plugins')).toBe(true);
    expect(hasRole('security', 'themes')).toBe(true);
    expect(hasRole('security', 'breakGlassApprove')).toBe(true);
    expect(hasRole('security', 'tenants')).toBe(false);
  });

  it('allows engineering to request break-glass but not approve', () => {
    const role: PlatformRole = 'engineering';
    expect(hasRole(role, 'breakGlassRequest')).toBe(true);
    expect(hasRole(role, 'breakGlassApprove')).toBe(false);
  });

  it('allows ops_support for support and health', () => {
    expect(hasRole('ops_support', 'support')).toBe(true);
    expect(hasRole('ops_support', 'health')).toBe(true);
    expect(hasRole('ops_support', 'plans')).toBe(false);
  });

  it('derives platform roles from canonical role IDs only (PRC-H001)', () => {
    expect(platformRoleFromJwtRoles([{ roleId: 'super-admin', roleName: 'Anything' }])).toBe(
      'platform_admin',
    );
    expect(platformRoleFromJwtRoles([{ roleId: 'security', roleName: 'Billing' }])).toBe(
      'security',
    );
    expect(
      platformRoleFromJwtRoles([{ roleId: 'admin', roleName: 'platform_admin' }]),
    ).toBeUndefined();
  });
});
