/**
 * PRC-H001 — the gateway's platform-area RBAC must mirror the admin-console
 * canonical AREA_ROLES / PLATFORM_ROLES (apps/admin-console/src/lib/auth/roles.ts),
 * and enforce area access as the console does.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AREA_ROLES,
  PLATFORM_ROLES,
  areaForPlatformRoute,
  hasAreaAccess,
  isAnyPlatformRole,
  isFullAccessPlatformRole,
} from './platform-area-rbac.js';

const rolesOf = (ids: string[]) => ids.map((roleId) => ({ roleId, roleName: roleId, areaId: 'r' }));

describe('PRC-H001 platform-area RBAC behavior', () => {
  it('platform_admin / super-admin have full access to every area', () => {
    for (const area of Object.keys(AREA_ROLES) as (keyof typeof AREA_ROLES)[]) {
      expect(hasAreaAccess(rolesOf(['platform_admin']), area)).toBe(true);
      expect(hasAreaAccess(rolesOf(['super-admin']), area)).toBe(true);
      expect(isFullAccessPlatformRole(rolesOf(['super-admin']))).toBe(true);
    }
  });

  it('billing may access tenants/plans but not plugins/break-glass', () => {
    expect(hasAreaAccess(rolesOf(['billing']), 'tenants')).toBe(true);
    expect(hasAreaAccess(rolesOf(['billing']), 'plans')).toBe(true);
    expect(hasAreaAccess(rolesOf(['billing']), 'plugins')).toBe(false);
    expect(hasAreaAccess(rolesOf(['billing']), 'breakGlassRequest')).toBe(false);
  });

  it('security may approve plugins/themes/break-glass but not suspend tenants', () => {
    expect(hasAreaAccess(rolesOf(['security']), 'plugins')).toBe(true);
    expect(hasAreaAccess(rolesOf(['security']), 'themes')).toBe(true);
    expect(hasAreaAccess(rolesOf(['security']), 'breakGlassApprove')).toBe(true);
    expect(hasAreaAccess(rolesOf(['security']), 'tenants')).toBe(false);
  });

  it('a non-platform role is not any platform role', () => {
    expect(isAnyPlatformRole(rolesOf(['teacher']))).toBe(false);
    expect(isAnyPlatformRole(rolesOf(['admin']))).toBe(false);
    expect(isAnyPlatformRole(rolesOf(['billing']))).toBe(true);
  });

  it('route → area mapping (with and without /api/v1 prefix)', () => {
    expect(areaForPlatformRoute('POST', '/tenants/:id/suspend')).toBe('tenants');
    expect(areaForPlatformRoute('POST', '/api/v1/tenants/x/suspend')).toBe('tenants');
    expect(areaForPlatformRoute('POST', '/plugins/:id/approve')).toBe('plugins');
    expect(areaForPlatformRoute('POST', '/break-glass')).toBe('breakGlassRequest');
    expect(areaForPlatformRoute('POST', '/break-glass/:id/approve')).toBe('breakGlassApprove');
    expect(areaForPlatformRoute('POST', '/break-glass/:id/deny')).toBe('breakGlassApprove');
    expect(areaForPlatformRoute('GET', '/platform/health')).toBe('health');
    expect(areaForPlatformRoute('GET', '/audit')).toBe('audit');
    expect(areaForPlatformRoute('GET', '/unknown-route')).toBeUndefined();
  });
});

describe('PRC-H001 parity with admin-console roles.ts', () => {
  const consoleSrc = readFileSync(
    fileURLToPath(new URL('../../admin-console/src/lib/auth/roles.ts', import.meta.url)),
    'utf8',
  );

  it('PLATFORM_ROLES match the console list', () => {
    // Extract the console PLATFORM_ROLES array literal.
    const match = consoleSrc.match(
      /export const PLATFORM_ROLES: PlatformRole\[\] = \[([\s\S]*?)\]/,
    );
    expect(match).toBeTruthy();
    const consoleRoles = [...match![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...PLATFORM_ROLES].sort()).toEqual([...consoleRoles].sort());
  });

  it('every gateway area role is one of the known platform roles', () => {
    const known = new Set<string>(PLATFORM_ROLES);
    for (const roles of Object.values(AREA_ROLES)) {
      for (const r of roles) expect(known.has(r)).toBe(true);
    }
  });

  it('console AREA_ROLES names are all covered by the gateway mapping', () => {
    // The console declares these areas; the gateway must map all of them.
    const consoleAreas = [...consoleSrc.matchAll(/^\s{2}([a-zA-Z]+): \[/gm)].map((m) => m[1]);
    for (const area of consoleAreas) {
      expect(Object.prototype.hasOwnProperty.call(AREA_ROLES, area)).toBe(true);
    }
  });
});
