import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { FixtureManifest } from '../seed/fixtures.js';
import { TENANTS } from '../seed/tenants.js';

import { createTokenFactory, decodeToken, mintToken } from './tokens.js';

const secret = 'unit-test-secret-0123456789abcdef0123456789';
const p = { sub: 'u1', tenantId: TENANTS.S.id, roles: ['teacher'] };

function verify(token: string, alg = 'sha256', key = secret): boolean {
  const [h, b, s] = token.split('.');
  return createHmac(alg, key).update(`${h}.${b}`).digest('base64url') === s;
}

describe('mintToken', () => {
  it('mints the gateway HS256 shape', () => {
    const t = mintToken(p, { secret });
    expect(verify(t)).toBe(true);
    const { header, payload } = decodeToken(t);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload).toMatchObject({
      iss: 'proctira-platform',
      aud: 'proctira-api',
      sub: 'u1',
      tenantId: TENANTS.S.id,
      roles: [{ roleId: 'teacher', roleName: 'teacher', areaId: null }],
      areas: [],
      institutions: [],
    });
    expect(Number(payload['exp']) - Number(payload['iat'])).toBe(8 * 3600);
    expect(typeof payload['jti']).toBe('string');
  });

  it('honours alg, signature, time and claim options', () => {
    expect(verify(mintToken(p, { secret, alg: 'HS512' }), 'sha512')).toBe(true);
    const none = mintToken(p, { alg: 'none' });
    expect(none.endsWith('.')).toBe(true);
    expect(decodeToken(none).header['alg']).toBe('none');
    expect(mintToken(p, { secret, signature: 'strip' }).split('.')[2]).toBe('');
    expect(verify(mintToken(p, { secret, signature: 'garble' }))).toBe(false);
    const t = decodeToken(
      mintToken(p, {
        secret,
        issuedAtSec: 1000,
        expiresInSec: 60,
        notBeforeSec: 1500,
        issuer: 'x',
        audience: 'y',
        header: { kid: 'k' },
      }),
    );
    expect(t.payload).toMatchObject({ iat: 1000, exp: 1060, nbf: 1500, iss: 'x', aud: 'y' });
    expect(t.header['kid']).toBe('k');
    expect(() => mintToken(p, {})).toThrow(/secret/);
  });
});

describe('createTokenFactory', () => {
  const fixtures = {
    tenants: { S: { id: TENANTS.S.id, slug: 's', status: 'active', institutions: ['i1', 'i2'] } },
    ids: {},
    principals: {
      guardians: { S: ['parent-mehta'] },
      students: { S: [{ sub: 'aitest-student-s', studentId: 'st1' }] },
    },
  } as unknown as FixtureManifest;
  const f = createTokenFactory(secret, fixtures);

  it('uses seeded subs for portal roles', () => {
    expect(f.principal('guardian', 'S').sub).toBe('parent-mehta');
    expect(f.principal('student', 'S').sub).toBe('aitest-student-s');
    expect(f.principal('teacher', 'S').sub).toBe('aitest-teacher-s');
    expect(f.principal('transport_officer', 'A').sub).toBe('aitest-transport-officer-a');
    expect(f.principal('teacher', 'S', { sub: 'x' }).sub).toBe('x');
  });

  it('scopes institutions and builds headers and cookies', () => {
    expect(f.principal('teacher', 'S', { institutions: 'all' }).institutions).toEqual(['i1', 'i2']);
    expect(f.principal('teacher', 'S', { institutions: 'none' }).institutions).toEqual([]);
    const h = f.headers('admin', 'S');
    expect(h['x-tenant-id']).toBe(TENANTS.S.id);
    expect(verify((h['authorization'] ?? '').replace('Bearer ', ''))).toBe(true);
    expect(f.headers('admin', 'S', { tenantHeader: TENANTS.A.id })['x-tenant-id']).toBe(
      TENANTS.A.id,
    );
    expect(f.sessionCookies('tok', 'http://localhost:34970').map((c) => c.name)).toEqual([
      'access_token',
      'refresh_token',
    ]);
    expect(decodeToken(f.token('admin', 'platform')).payload['tenantId']).toBe('platform');
  });
});
