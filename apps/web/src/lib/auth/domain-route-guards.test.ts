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
    for (const roles of [
      ['admin'],
      ['principal'],
      ['super-admin'],
      ['PRINCIPAL'],
      // T-O1: the gateway now grants the transport package staff roles.
      ['transport_officer'],
      ['transport-officer'],
      ['transport_manager'],
      ['transport-manager'],
      ['fleet_manager'],
      ['fleet-manager'],
      ['transport_admin'],
      ['transport-admin'],
      // Read-only at the gateway (writes are 403 there).
      ['registrar'],
    ]) {
      expect(canAccessDashboardDomain(session(roles), 'transport'), roles.join()).toBe(true);
    }
    for (const roles of [
      // Gateway STAFF_READS grants transport.read, the package guard denies.
      ['teacher'],
      ['staff'],
      // Gateway grants '*', the package guard has no platform role.
      ['platform_admin'],
      // Hostel staff hold no transport grant at the gateway or in the package.
      ['warden'],
      ['hostel_manager'],
      ['student'],
      ['parent'],
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
    for (const roles of [
      ['admin'],
      ['principal'],
      ['super-admin'],
      ['ADMIN'],
      // H-D2: the gateway now grants the hostel package staff roles.
      ['warden'],
      ['hostel_warden'],
      ['hostel-warden'],
      ['hostel_manager'],
      ['hostel-manager'],
      ['hostel_admin'],
      ['hostel-admin'],
      ['hostel_clerk'],
      // Read-only at the gateway (writes are 403 there).
      ['registrar'],
    ]) {
      expect(canAccessDashboardDomain(session(roles), 'hostel'), roles.join()).toBe(true);
    }
    for (const roles of [
      // Gateway STAFF_READS grants hostel.read, the package guard denies.
      ['teacher'],
      ['staff'],
      // Gateway grants '*', the package guard has no platform role.
      ['platform_admin'],
      // Transport staff hold no hostel grant at the gateway or in the package.
      ['transport_officer'],
      ['fleet_manager'],
      // Fee roles: no gateway `hostel` grant (residual, not in this change).
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

  it('MR-1: a multi-role session gets the gateway answer (one role grants, another passes the package)', () => {
    // Each pair is served by the gateway (apps/api-gateway rbac-campus-roles.test.ts).
    const served: Array<[string[], 'hostel' | 'transport']> = [
      [['teacher', 'transport_officer'], 'transport'],
      [['teacher', 'registrar'], 'transport'],
      [['teacher', 'registrar'], 'hostel'],
      [['staff', 'hostel_manager'], 'hostel'],
      [['student', 'warden'], 'hostel'],
      // The grant comes only from teacher/staff (gateway STAFF_READS): the
      // package role has no web or gateway registry entry.
      [['teacher', 'school_admin'], 'hostel'],
      [['staff', 'school-admin'], 'transport'],
      [['teacher', 'system_admin'], 'transport'],
    ];
    for (const [roles, domain] of served) {
      expect(canAccessDashboardDomain(session(roles), domain), `${roles.join('+')} ${domain}`).toBe(
        true,
      );
    }
    const denied: Array<[string[], 'hostel' | 'transport']> = [
      // Package role without any gateway grant on the domain.
      [['school_admin'], 'hostel'],
      [['system-admin'], 'transport'],
      [['guardian', 'school_admin'], 'hostel'],
      [['parent', 'school_admin'], 'transport'],
      // Gateway readers without a package role.
      [['teacher', 'staff'], 'hostel'],
      [['teacher', 'guardian'], 'transport'],
      // A role for the other domain does not open this one.
      [['teacher', 'warden'], 'transport'],
      [['staff', 'transport_officer'], 'hostel'],
      [['guardian'], 'hostel'],
      [['guardian'], 'transport'],
    ];
    for (const [roles, domain] of denied) {
      expect(canAccessDashboardDomain(session(roles), domain), `${roles.join('+')} ${domain}`).toBe(
        false,
      );
    }
  });

  it('MR-1: the base-reader rule does not leak into other domains', () => {
    // school_admin is in neither registry; teacher holds no web `platform` grant.
    expect(canAccessDashboardDomain(session(['teacher', 'school_admin']), 'billing')).toBe(false);
    expect(canAccessDashboardDomain(session(['teacher', 'school_admin']), 'audit-logs')).toBe(
      false,
    );
    expect(canAccessDashboardDomain(session(['staff', 'school_admin']), 'data-warehouse')).toBe(
      canAccessDashboardDomain(session(['staff']), 'data-warehouse'),
    );
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
