import { describe, expect, it } from 'vitest';

import { decodeAdminToken, isAdminTokenExpired } from './session';

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('decodeAdminToken', () => {
  it('returns null for malformed tokens', () => {
    expect(decodeAdminToken('')).toBeNull();
    expect(decodeAdminToken('a.b')).toBeNull();
    expect(decodeAdminToken('not-a-jwt')).toBeNull();
  });

  it('derives platform_admin from canonical role IDs emitted by TokenService (PRC-H001)', () => {
    const token = makeToken({
      sub: 'op-1',
      email: 'ops@proctira.org',
      roles: [{ roleId: 'platform_admin', roleName: 'Platform Administrator' }],
      tenantId: 'platform',
      iat: 1,
      exp: 9_999_999_999,
    });

    expect(decodeAdminToken(token)?.platformRole).toBe('platform_admin');
  });

  it('never derives a platform role from a tenant-scoped token (PRC-H001)', () => {
    const token = makeToken({
      sub: 'tenant-admin',
      email: 'admin@school.example',
      roles: [{ roleId: 'super-admin', roleName: 'Super Administrator' }],
      tenantId: '5a58f9ff-b6a6-43bd-a014-bb622f763e48',
      iat: 1,
      exp: 9_999_999_999,
    });

    expect(decodeAdminToken(token)?.platformRole).toBeUndefined();
  });

  it('does not trust a role display name as a platform permission (PRC-H001)', () => {
    const token = makeToken({
      sub: 'op-1',
      email: 'ops@proctira.org',
      roles: [{ roleId: 'admin', roleName: 'platform_admin' }],
      tenantId: 'platform',
      iat: 1,
      exp: 9_999_999_999,
    });

    expect(decodeAdminToken(token)?.platformRole).toBeUndefined();
  });

});

describe('isAdminTokenExpired', () => {
  it('treats missing/invalid tokens as expired', () => {
    expect(isAdminTokenExpired('')).toBe(true);
    expect(isAdminTokenExpired('x.y.z')).toBe(true);
  });

  it('detects past exp (with 30s buffer)', () => {
    const past = makeToken({
      sub: 'op-1',
      email: 'ops@proctira.org',
      tenantId: 'platform',
      iat: 1,
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    expect(isAdminTokenExpired(past)).toBe(true);
  });

  it('accepts tokens with future exp', () => {
    const future = makeToken({
      sub: 'op-1',
      email: 'ops@proctira.org',
      tenantId: 'platform',
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(isAdminTokenExpired(future)).toBe(false);
  });
});
