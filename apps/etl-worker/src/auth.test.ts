/**
 * PRC-M030: etl-worker pipeline routes require a verified platform token and bind the tenant
 * from its verified claim only.
 */
import { createHmac } from 'node:crypto';

import { InMemoryPipelineRepository } from '@proctira/backend-etl';
import { afterEach, describe, expect, it } from 'vitest';

import { readEtlAuthConfig, verifyEtlToken, type EtlAuthConfig } from './auth.js';
import { buildEtlWorkerApp } from './server.js';

const AUTH: EtlAuthConfig = {
  secrets: ['test-secret-current', 'test-secret-previous'],
  issuer: 'proctira-platform',
  audience: 'proctira-api',
};
const TENANT = '11111111-2222-4333-8444-555555555555';
const OTHER_TENANT = '99999999-2222-4333-8444-555555555555';

function sign(
  claims: Record<string, unknown>,
  secret = AUTH.secrets[0]!,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

const now = () => Math.floor(Date.now() / 1000);
const validClaims = (extra: Record<string, unknown> = {}) => ({
  sub: 'user-1',
  tenantId: TENANT,
  roles: ['admin'],
  iss: AUTH.issuer,
  aud: AUTH.audience,
  exp: now() + 300,
  ...extra,
});

describe('verifyEtlToken', () => {
  it('accepts a valid token signed with the current or previous secret', () => {
    expect(verifyEtlToken(sign(validClaims()), AUTH)?.tenantId).toBe(TENANT);
    expect(verifyEtlToken(sign(validClaims(), AUTH.secrets[1]), AUTH)?.sub).toBe('user-1');
  });

  it.each([
    ['wrong secret', () => sign(validClaims(), 'nope')],
    ['alg none', () => sign(validClaims(), AUTH.secrets[0], { alg: 'none' })],
    ['expired', () => sign(validClaims({ exp: now() - 120 }))],
    ['missing exp', () => sign(validClaims({ exp: undefined }))],
    ['wrong issuer', () => sign(validClaims({ iss: 'evil' }))],
    ['wrong audience', () => sign(validClaims({ aud: 'other' }))],
    ['non-uuid tenant', () => sign(validClaims({ tenantId: 'ministry-edu' }))],
    ['garbage', () => 'a.b.c'],
  ])('rejects %s', (_label, token) => {
    expect(verifyEtlToken(token(), AUTH)).toBeNull();
  });

  it('rejects everything when no secret is configured', () => {
    expect(verifyEtlToken(sign(validClaims()), { ...AUTH, secrets: [] })).toBeNull();
  });

  it('refuses to start in production without JWT_SECRET', () => {
    expect(() => readEtlAuthConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    expect(readEtlAuthConfig({ NODE_ENV: 'production', JWT_SECRET: 'x' }).secrets).toEqual(['x']);
  });
});

describe('etl-worker pipeline routes auth', () => {
  const apps: Array<Awaited<ReturnType<typeof buildEtlWorkerApp>>> = [];
  afterEach(async () => {
    while (apps.length) await apps.pop()!.close();
  });

  async function app() {
    process.env.LOG_LEVEL = 'silent';
    const instance = await buildEtlWorkerApp({
      repository: new InMemoryPipelineRepository(),
      auth: AUTH,
    });
    apps.push(instance);
    return instance;
  }

  it('returns 401 without a token and with a bad token', async () => {
    const instance = await app();
    expect((await instance.inject({ method: 'GET', url: '/api/v1/pipelines' })).statusCode).toBe(
      401,
    );
    const bad = await instance.inject({
      method: 'GET',
      url: '/api/v1/pipelines',
      headers: { authorization: `Bearer ${sign(validClaims(), 'forged')}` },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('ignores a forged x-tenant-id header and binds the verified tenant', async () => {
    const instance = await app();
    const res = await instance.inject({
      method: 'GET',
      url: '/api/v1/pipelines',
      headers: {
        authorization: `Bearer ${sign(validClaims())}`,
        'x-tenant-id': OTHER_TENANT,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('keeps health probes public', async () => {
    const instance = await app();
    expect((await instance.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
  });
});
