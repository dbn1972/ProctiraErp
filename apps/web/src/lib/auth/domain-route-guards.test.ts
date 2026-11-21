/**
 * PRC-L034 — negative authz for dashboard domain layouts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ServerSession } from '@/lib/auth/server';
import {
  canAccessDashboardDomain,
  DASHBOARD_DOMAIN_RESOURCES,
  HOSTEL_PACKAGE_ROLE_IDS,
  TRANSPORT_PACKAGE_ROLE_IDS,
} from './domain-route-guards';

function session(roleIds: string[]): ServerSession {
  return {
    accessToken: 'test-token',
    refreshToken: null,
    isExpired: false,
    user: {
      sub: 'user-1',
      tenantId: 'tenant-a',
      email: 'test@tenant-a.test',
      roles: roleIds.map((roleId) => ({ roleId, roleName: roleId, areaId: 'area-1' })),
      iat: 0,
      exp: 9999999999,
    },
  };
}

describe('dashboard domain route guards (PRC-L034)', () => {
  it('denies a student session on /communication (emergency) and other staff domains', () => {
    for (const domain of Object.keys(DASHBOARD_DOMAIN_RESOURCES) as Array<
      keyof typeof DASHBOARD_DOMAIN_RESOURCES
    >) {
      expect(canAccessDashboardDomain(session(['student']), domain)).toBe(false);
      expect(canAccessDashboardDomain(session(['guardian']), domain)).toBe(false);
      expect(canAccessDashboardDomain(session(['parent']), domain)).toBe(false);
    }
  });

  it('denies users with no roles', () => {
    expect(canAccessDashboardDomain(session([]), 'attendance')).toBe(false);
  });

  it('allows staff roles for their domains', () => {
    expect(canAccessDashboardDomain(session(['teacher']), 'attendance')).toBe(true);
    expect(canAccessDashboardDomain(session(['teacher']), 'communication')).toBe(true);
    expect(canAccessDashboardDomain(session(['admin']), 'communication')).toBe(true);
    expect(canAccessDashboardDomain(session(['admin']), 'data-warehouse')).toBe(true);
  });

  it('restricts platform surfaces to platform administrators', () => {
    expect(canAccessDashboardDomain(session(['admin']), 'billing')).toBe(false);
    expect(canAccessDashboardDomain(session(['admin']), 'audit-logs')).toBe(false);
    expect(canAccessDashboardDomain(session(['platform_admin']), 'billing')).toBe(true);
    expect(canAccessDashboardDomain(session(['super-admin']), 'audit-logs')).toBe(true);
  });

  it('T-D1: grants transport only where the gateway and the transport package both allow it', () => {
    // Gateway grant (rbac-registry.ts) AND package guard (transport-access.ts).
    for (const roles of [['admin'], ['principal'], ['super-admin'], ['PRINCIPAL']]) {
      expect(canAccessDashboardDomain(session(roles), 'transport'), roles.join()).toBe(true);
    }
    for (const roles of [
      // Gateway STAFF_READS grants transport.read, the package guard denies.
      ['teacher'],
      ['staff'],
      // Gateway grants '*', the package guard has no platform role.
      ['platform_admin'],
      // T-O1: package allows, the gateway registry has no such role (403).
      ['transport_officer'],
      ['transport-manager'],
      ['fleet_manager'],
      ['transport_admin'],
      ['registrar'],
      ['student'],
      ['guardian'],
      [],
    ]) {
      expect(canAccessDashboardDomain(session(roles), 'transport'), roles.join()).toBe(false);
    }
    // Any role carrying both grants is enough, as at the gateway.
    expect(canAccessDashboardDomain(session(['teacher', 'principal']), 'transport')).toBe(true);
  });

  it('T-D1: mirrors every transport package role the web guard lets through', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../../packages/backend/transport/src/transport-access.ts'),
      'utf8',
    );
    const packageRoles = new Set(
      [...src.matchAll(/^\s+'([a-z_-]+)',$/gm)].map((match) => match[1]!.toLowerCase()),
    );
    expect(packageRoles.size).toBeGreaterThan(0);
    for (const roleId of TRANSPORT_PACKAGE_ROLE_IDS) {
      expect(packageRoles.has(roleId), roleId).toBe(true);
    }
    for (const roleId of packageRoles) {
      expect(TRANSPORT_PACKAGE_ROLE_IDS.has(roleId), roleId).toBe(true);
    }
  });

  it('H-D1: grants hostel only where the gateway and the hostel package both allow it', () => {
    // Gateway grant (rbac-registry.ts) AND package guard (hostel-access.ts).
    for (const roles of [['admin'], ['principal'], ['super-admin'], ['ADMIN']]) {
      expect(canAccessDashboardDomain(session(roles), 'hostel'), roles.join()).toBe(true);
    }
    for (const roles of [
      // Gateway STAFF_READS grants hostel.read, the package guard denies.
      ['teacher'],
      ['staff'],
      // Gateway grants '*', the package guard has no platform role.
      ['platform_admin'],
      // H-D2: package allows, the gateway registry grants them no `hostel` (403).
      ['warden'],
      ['hostel_warden'],
      ['hostel-manager'],
      ['hostel_admin'],
      ['hostel_clerk'],
      ['registrar'],
      // Fee roles: no gateway `hostel` grant either.
      ['bursar'],
      ['accountant'],
      // Portal roles (the gateway grants student hostel.read, the package denies).
      ['student'],
      ['parent'],
      ['guardian'],
      [],
    ]) {
      expect(canAccessDashboardDomain(session(roles), 'hostel'), roles.join()).toBe(false);
    }
    expect(canAccessDashboardDomain(session(['teacher', 'principal']), 'hostel')).toBe(true);
  });

  it('H-D1: mirrors the hostel package hostel.read roles exactly', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../../packages/backend/hostel/src/hostel-access.ts'),
      'utf8',
    );
    const block = (name: string): string[] => {
      const body = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(src)?.[1];
      expect(body, name).toBeDefined();
      return [...body!.matchAll(/'([a-z_-]+)'/g)].map((match) => match[1]!);
    };
    expect(src).toMatch(/'hostel\.read': HOSTEL_STAFF_ROLES,/);
    expect(block('HOSTEL_STAFF_ROLES')).toContain('warden');
    expect(src).toMatch(
      /const HOSTEL_STAFF_ROLES = \[[\s\S]*?\.\.\.ADMIN_ROLES,[\s\S]*?\] as const;/,
    );
    const packageRoles = new Set([...block('HOSTEL_STAFF_ROLES'), ...block('ADMIN_ROLES')]);
    expect([...HOSTEL_PACKAGE_ROLE_IDS].sort()).toEqual([...packageRoles].sort());
  });

  it('wires every domain layout to the guard', () => {
    for (const domain of Object.keys(DASHBOARD_DOMAIN_RESOURCES)) {
      const src = readFileSync(
        resolve(__dirname, `../../app/(dashboard)/${domain}/layout.tsx`),
        'utf8',
      );
      expect(src).toContain(`canAccessDashboardDomain(session, '${domain}')`);
      expect(src).toContain('RouteAccessDenied');
    }
  });
});
