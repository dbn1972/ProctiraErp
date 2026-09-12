import { describe, it, expect } from 'vitest';

import {
  authUserFromTokenPayload,
  normaliseAuthRole,
  rolesFromTokenPayload,
  scopeFromTokenPayload,
} from './auth-user';
import type { TokenPayload } from './session';

function payload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    sub: 'user-1',
    tenantId: 'tenant-1',
    email: 'admin@school.test',
    displayName: 'Admin User',
    roles: [{ roleId: 'principal', roleName: 'Principal', areaId: 'area-1' }],
    iat: 1,
    exp: 9_999_999_999,
    ...overrides,
  };
}

describe('normaliseAuthRole', () => {
  it('lowercases and converts underscores to hyphens', () => {
    expect(normaliseAuthRole('BOARD_ADMIN')).toBe('board-admin');
  });
});

describe('rolesFromTokenPayload', () => {
  it('prefers roleId and normalises names', () => {
    expect(
      rolesFromTokenPayload(
        payload({
          roles: [
            { roleId: 'BOARD_ADMIN', roleName: 'Board Admin', areaId: 'a' },
            { roleId: '', roleName: 'Teacher', areaId: 'a' },
          ],
        }),
      ),
    ).toEqual(['board-admin', 'teacher']);
  });
});

describe('scopeFromTokenPayload', () => {
  it('maps country / state / board / school scopes', () => {
    expect(
      scopeFromTokenPayload(
        payload({
          roles: [{ roleId: 'ministry-admin', roleName: 'Ministry', areaId: 'c1' }],
        }),
      ).level,
    ).toBe('country');

    expect(
      scopeFromTokenPayload(
        payload({
          roles: [{ roleId: 'state-director', roleName: 'State', areaId: 's1' }],
        }),
      ).level,
    ).toBe('state');

    expect(
      scopeFromTokenPayload(
        payload({
          roles: [{ roleId: 'board-admin', roleName: 'Board', areaId: 'b1' }],
        }),
      ),
    ).toEqual({ level: 'board', area_id: 'b1', board_id: 'b1' });

    expect(
      scopeFromTokenPayload(
        payload({
          roles: [
            {
              roleId: 'principal',
              roleName: 'Principal',
              areaId: 'a1',
              institutionId: 'inst-1',
            },
          ],
        }),
      ),
    ).toEqual({ level: 'school', area_id: 'a1', institution_id: 'inst-1' });
  });
});

describe('authUserFromTokenPayload', () => {
  it('maps JWT claims into AuthUser without inventing permissions', () => {
    const user = authUserFromTokenPayload(payload());
    expect(user).toEqual({
      id: 'user-1',
      email: 'admin@school.test',
      name: 'Admin User',
      roles: ['principal'],
      permissions: [],
      scope: { level: 'school', area_id: 'area-1' },
      tenant_id: 'tenant-1',
    });
  });

  it('falls back to email when displayName is missing', () => {
    const user = authUserFromTokenPayload(payload({ displayName: undefined }));
    expect(user.name).toBe('admin@school.test');
  });
});
