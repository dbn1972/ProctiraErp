/**
 * W1-SEC-09 — access-token jti/sid revocation unit tests.
 */
import { createAuthConfig } from '@proctira/auth';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertAccessTokenNotRevoked,
  MemoryAccessTokenRevocationStore,
  revokeAccessTokenIdentifiers,
} from './access-token-revocation.js';
import { authPlugin } from './auth-plugin.js';

describe('assertAccessTokenNotRevoked', () => {
  it('rejects a revoked jti (fail closed)', async () => {
    const store = new MemoryAccessTokenRevocationStore();
    await store.revoke('jti', 'jti-revoked', 60);
    const result = await assertAccessTokenNotRevoked(
      { jti: 'jti-revoked', sessionId: 'sid-ok' },
      { store, nodeEnv: 'test', requireStore: true },
    );
    expect(result).toEqual({ ok: false, reason: 'revoked_jti' });
  });

  it('rejects a revoked sid / sessionId (fail closed)', async () => {
    const store = new MemoryAccessTokenRevocationStore();
    await store.revoke('sid', 'sid-revoked', 60);
    const result = await assertAccessTokenNotRevoked(
      { jti: 'jti-ok', sessionId: 'sid-revoked' },
      { store, nodeEnv: 'test', requireStore: true },
    );
    expect(result).toEqual({ ok: false, reason: 'revoked_sid' });
  });

  it('accepts claims that are not on the denylist', async () => {
    const store = new MemoryAccessTokenRevocationStore();
    const result = await assertAccessTokenNotRevoked(
      { jti: 'jti-ok', sessionId: 'sid-ok' },
      { store, nodeEnv: 'test', requireStore: true },
    );
    expect(result).toEqual({ ok: true });
  });

  it('fails closed in production when the store is missing', async () => {
    const result = await assertAccessTokenNotRevoked(
      { jti: 'jti-ok', sessionId: 'sid-ok' },
      { store: null, nodeEnv: 'production' },
    );
    expect(result).toEqual({ ok: false, reason: 'store_unavailable' });
  });

  it('revokeAccessTokenIdentifiers denylists both jti and sid', async () => {
    const store = new MemoryAccessTokenRevocationStore();
    await revokeAccessTokenIdentifiers(store, { jti: 'j1', sessionId: 's1' }, 120);
    expect(await store.isRevoked('jti', 'j1')).toBe(true);
    expect(await store.isRevoked('sid', 's1')).toBe(true);
  });
});

describe('authPlugin authenticate — revoked access token', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('returns 401 TOKEN_REVOKED when jti is denylisted', async () => {
    const store = new MemoryAccessTokenRevocationStore();
    const config = createAuthConfig({
      jwt: {
        secret: 'test-secret-at-least-32-characters-long!!',
        issuer: 'proctira-test',
        audience: 'proctira-api',
        accessTokenExpiresIn: 900,
      },
    });

    const app = Fastify();
    apps.push(app);
    await app.register(authPlugin, { config, revocationStore: store });
    app.get('/protected', { preHandler: [app.authenticate] }, async () => ({ ok: true }));
    await app.ready();

    const token = app.jwt.sign({
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'a@example.com',
      displayName: 'A',
      roles: [],
      areas: [],
      institutions: [],
      jti: 'jti-to-revoke',
      sessionId: 'sid-1',
    });

    const allowed = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(allowed.statusCode).toBe(200);

    await store.revoke('jti', 'jti-to-revoke', 900);

    const denied = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({
      code: 'TOKEN_REVOKED',
      reason: 'revoked_jti',
    });
  });

  it('returns 401 TOKEN_REVOKED when sid is denylisted', async () => {
    const store = new MemoryAccessTokenRevocationStore();
    const config = createAuthConfig({
      jwt: {
        secret: 'test-secret-at-least-32-characters-long!!',
        issuer: 'proctira-test',
        audience: 'proctira-api',
        accessTokenExpiresIn: 900,
      },
    });

    const app = Fastify();
    apps.push(app);
    await app.register(authPlugin, { config, revocationStore: store });
    app.get('/protected', { preHandler: [app.authenticate] }, async () => ({ ok: true }));
    await app.ready();

    const token = app.jwt.sign({
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'a@example.com',
      displayName: 'A',
      roles: [],
      areas: [],
      institutions: [],
      jti: 'jti-2',
      sessionId: 'sid-to-revoke',
    });

    await store.revoke('sid', 'sid-to-revoke', 900);

    const denied = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({
      code: 'TOKEN_REVOKED',
      reason: 'revoked_sid',
    });
  });
});
