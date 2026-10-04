/**
 * PRC-L234 — web-tier admin route gate and platform card visibility.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ServerSession } from '@/lib/auth/server';
import {
  canAccessAdminRoutes,
  canSeePlatformSections,
  sessionHasPermission,
} from './permission-guards';

function sessionWithRoles(roleIds: string[]): ServerSession {
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
  } as ServerSession;
}

describe('canAccessAdminRoutes (PRC-L234)', () => {
  it.each(['teacher', 'staff', 'student', 'guardian', 'principal'])('denies %s', (role) => {
    expect(canAccessAdminRoutes(sessionWithRoles([role]))).toBe(false);
  });
  it.each(['admin', 'super-admin', 'SUPER_ADMIN', 'platform_admin'])('allows %s', (role) => {
    expect(canAccessAdminRoutes(sessionWithRoles([role]))).toBe(true);
  });
  it('denies a session with no roles', () => {
    expect(canAccessAdminRoutes(sessionWithRoles([]))).toBe(false);
  });
});

describe('canSeePlatformSections (PRC-L234)', () => {
  it('hides platform cards from tenant admins', () => {
    expect(canSeePlatformSections(sessionWithRoles(['admin']))).toBe(false);
  });
  it('shows platform cards to platform/super admins', () => {
    expect(canSeePlatformSections(sessionWithRoles(['platform_admin']))).toBe(true);
    expect(canSeePlatformSections(sessionWithRoles(['super_admin']))).toBe(true);
  });
  it('resolves manage as implying read', () => {
    expect(sessionHasPermission(sessionWithRoles(['admin']), 'examination', 'read')).toBe(true);
  });
});

describe('admin layout wiring (PRC-L234)', () => {
  it('gates /admin/* with canAccessAdminRoutes before rendering children', () => {
    const src = readFileSync(resolve(__dirname, '../../app/(dashboard)/admin/layout.tsx'), 'utf8');
    expect(src).toMatch(/if \(!canAccessAdminRoutes\(session\)\)/);
    expect(src).toContain('RouteAccessDenied');
  });
  it('renders the platform group only when canSeePlatformSections is true', () => {
    const src = readFileSync(resolve(__dirname, '../../app/(dashboard)/admin/page.tsx'), 'utf8');
    expect(src).toMatch(/showPlatform \? \(/);
  });
});
