/**
 * @vitest-environment node
 *
 * GET /api/auth/session — cookie session gate (P0-02 auth shell unstub).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getSessionMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  getSession: () => getSessionMock(),
}));

import { GET } from './route';

describe('GET /api/auth/session', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns unauthenticated when no session cookie', async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ authenticated: false, user: null });
  });

  it('returns expired soft-fail without inventing a stub user', async () => {
    getSessionMock.mockResolvedValue({
      accessToken: 'x',
      refreshToken: 'y',
      isExpired: true,
      user: {
        sub: 'u1',
        tenantId: 't1',
        email: 'a@b.c',
        roles: [],
        iat: 1,
        exp: 1,
      },
    });
    const res = await GET();
    await expect(res.json()).resolves.toEqual({
      authenticated: false,
      user: null,
      reason: 'expired',
    });
  });

  it('maps a live cookie session into AuthUser claims', async () => {
    getSessionMock.mockResolvedValue({
      accessToken: 'tok',
      refreshToken: 'ref',
      isExpired: false,
      user: {
        sub: 'user-99',
        tenantId: 'tenant-99',
        email: 'principal@school.test',
        displayName: 'Priya Principal',
        roles: [
          {
            roleId: 'principal',
            roleName: 'Principal',
            areaId: 'area-9',
            institutionId: 'inst-9',
          },
        ],
        iat: 1,
        exp: 9_999_999_999,
      },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.user).toMatchObject({
      id: 'user-99',
      email: 'principal@school.test',
      name: 'Priya Principal',
      roles: ['principal'],
      tenant_id: 'tenant-99',
      scope: { level: 'school', area_id: 'area-9', institution_id: 'inst-9' },
    });
    expect(body.accessToken).toBeUndefined();
  });
});
