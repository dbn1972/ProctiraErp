/**
 * W1-SEC-02 (D5) — negative authz for examination dashboard routes.
 *
 * Authenticated users without `examination.read` must be denied before any
 * examination page content or download proxy is served.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import type { ServerSession } from '@/lib/auth/server';

import {
  canAccessExaminationRoutes,
  sessionHasExaminationRead,
} from './examination-route-guards';

function sessionWithRoles(
  roleIds: string[],
  overrides?: Partial<ServerSession['user']>,
): ServerSession {
  return {
    accessToken: 'test-token',
    refreshToken: null,
    isExpired: false,
    user: {
      sub: 'user-1',
      tenantId: 'tenant-a',
      email: 'test@tenant-a.test',
      roles: roleIds.map((roleId) => ({
        roleId,
        roleName: roleId,
        areaId: 'area-1',
      })),
      iat: 0,
      exp: 9999999999,
      ...overrides,
    },
  };
}

describe('W1-SEC-02 examination route guards (negative authz)', () => {
  it('denies users with no role assignments', () => {
    const session = sessionWithRoles([]);
    expect(sessionHasExaminationRead(session)).toBe(false);
    expect(canAccessExaminationRoutes(session)).toBe(false);
  });

  it('denies transport-only persona (mismatched scope)', () => {
    const session = sessionWithRoles(['transport_coordinator']);
    expect(sessionHasExaminationRead(session)).toBe(false);
    expect(canAccessExaminationRoutes(session)).toBe(false);
  });

  it('denies guardian persona without examination.read', () => {
    const session = sessionWithRoles(['guardian']);
    expect(sessionHasExaminationRead(session)).toBe(false);
    expect(canAccessExaminationRoutes(session)).toBe(false);
  });

  it('allows admin persona with examination.manage', () => {
    const session = sessionWithRoles(['admin']);
    expect(sessionHasExaminationRead(session)).toBe(true);
    expect(canAccessExaminationRoutes(session)).toBe(true);
  });

  it('allows teacher persona with gateway STAFF_READS examination.read', () => {
    const session = sessionWithRoles(['teacher']);
    expect(sessionHasExaminationRead(session)).toBe(true);
    expect(canAccessExaminationRoutes(session)).toBe(true);
  });
});

describe('examinations layout wiring', () => {
  it('gates the route group on canAccessExaminationRoutes', () => {
    const layoutSrc = readFileSync(
      resolve(__dirname, '../../app/(dashboard)/examinations/layout.tsx'),
      'utf-8',
    );

    expect(layoutSrc).toContain('canAccessExaminationRoutes');
    expect(layoutSrc).toContain('RouteAccessDenied');
  });
});
