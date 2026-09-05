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

  it('decodes a structurally valid payload', () => {
    const token = makeToken({
      sub: 'op-1',
      email: 'ops@proctira.org',
      platformRole: 'security',
      tenantId: 'platform',
      iat: 1,
      exp: 9_999_999_999,
    });
    const payload = decodeAdminToken(token);
    expect(payload?.email).toBe('ops@proctira.org');
    expect(payload?.platformRole).toBe('security');
    expect(payload?.tenantId).toBe('platform');
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
