/**
 * Unit tests for dashboard scope derivation (`scope.ts`).
 *
 * PRC-L451: unknown/absent roles must resolve to the explicit `none` deny
 * level and be refused every dashboard variant; multi-role users must be
 * authorised for every level they hold.
 *
 * PRC-M591: school/teacher roles are anchored to an institution, not an area —
 * their `areaId` must NOT widen `areaIds` (which would let a principal read
 * every school in their state).
 */
import type { JwtPayload, RoleAssignment } from '@proctira/auth';
import { describe, expect, it } from 'vitest';

import { canAccessVariant, deriveDashboardScope, type DashboardVariant } from './scope.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';

function jwtFor(roles: RoleAssignment[], institutions: string[] = []): JwtPayload {
  return {
    sub: 'user-1',
    tenantId: TENANT_ID,
    email: 'user@example.com',
    displayName: 'Test User',
    roles,
    areas: [],
    institutions,
    iat: 0,
    exp: 9_999_999_999,
    jti: 'jti',
    sessionId: 'session',
  };
}

const ALL_VARIANTS: DashboardVariant[] = [
  'country',
  'state',
  'board-admin',
  'school',
  'teacher',
  'me',
];

describe('deriveDashboardScope — PRC-L451 (unknown/no-role users)', () => {
  it('resolves no roles to the `none` level and denies every dashboard', () => {
    const scope = deriveDashboardScope(jwtFor([]));
    expect(scope.level).toBe('none');
    expect(scope.heldLevels).toEqual([]);
    for (const variant of ALL_VARIANTS) {
      expect(canAccessVariant(scope, variant)).toBe(false);
    }
  });

  it('resolves an unrecognised role to `none` and denies every dashboard', () => {
    const scope = deriveDashboardScope(
      jwtFor([{ roleId: 'made_up_role', roleName: 'Mystery', areaId: 'state-MH' }]),
    );
    expect(scope.level).toBe('none');
    for (const variant of ALL_VARIANTS) {
      expect(canAccessVariant(scope, variant)).toBe(false);
    }
  });

  it('grants a super_admin the country dashboard', () => {
    const scope = deriveDashboardScope(
      jwtFor([{ roleId: 'system_admin', roleName: 'Sys', areaId: 'country' }]),
    );
    expect(canAccessVariant(scope, 'country')).toBe(true);
  });

  it('authorises a multi-role (principal + teacher) user for BOTH dashboards', () => {
    const scope = deriveDashboardScope(
      jwtFor([
        { roleId: 'principal', roleName: 'Principal', areaId: 'state-MH', institutionId: 'inst-1' },
        { roleId: 'teacher', roleName: 'Teacher', areaId: 'state-MH', institutionId: 'inst-1' },
      ]),
    );
    expect(scope.heldLevels).toContain('school');
    expect(scope.heldLevels).toContain('teacher');
    expect(canAccessVariant(scope, 'school')).toBe(true);
    expect(canAccessVariant(scope, 'teacher')).toBe(true);
  });
});

describe('deriveDashboardScope — PRC-M591 (school/teacher area anchoring)', () => {
  it('does NOT add a principal role areaId to areaIds', () => {
    const scope = deriveDashboardScope(
      jwtFor(
        [
          {
            roleId: 'principal',
            roleName: 'Principal',
            areaId: 'state-MH',
            institutionId: 'inst-MH-001',
          },
        ],
        ['inst-MH-001'],
      ),
    );
    expect(scope.areaIds).not.toContain('state-MH');
    expect(scope.areaIds).toEqual([]);
    expect(scope.institutionIds).toContain('inst-MH-001');
  });

  it('does NOT add a teacher role areaId to areaIds', () => {
    const scope = deriveDashboardScope(
      jwtFor([
        {
          roleId: 'teacher',
          roleName: 'Teacher',
          areaId: 'state-MH',
          institutionId: 'inst-MH-001',
        },
      ]),
    );
    expect(scope.areaIds).toEqual([]);
    expect(scope.institutionIds).toContain('inst-MH-001');
  });

  it('still gives a state director their area breadth', () => {
    const scope = deriveDashboardScope(
      jwtFor([{ roleId: 'state_director', roleName: 'State Director', areaId: 'state-MH' }]),
    );
    expect(scope.areaIds).toContain('state-MH');
    expect(canAccessVariant(scope, 'school')).toBe(true);
  });
});
