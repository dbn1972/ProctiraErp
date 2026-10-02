/**
 * PRC-L034 — negative authz for dashboard domain layouts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ServerSession } from '@/lib/auth/server';
import { canAccessDashboardDomain, DASHBOARD_DOMAIN_RESOURCES } from './domain-route-guards';

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
