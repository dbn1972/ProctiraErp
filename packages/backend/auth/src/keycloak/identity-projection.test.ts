import { generateKeyPairSync, sign } from 'node:crypto';

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryAccessTokenRevocationStore } from '../access-token-revocation.js';

import * as identityModule from './identity.js';
import {
  InMemoryKeycloakIdentityStore,
  linkKeycloakIdentity,
  type KeycloakIdentityStore,
} from './identity.js';
import { keycloakAuthPlugin } from './plugin.js';

const issuer = 'http://localhost:8180/realms/proctira';
const config = {
  issuer,
  clientId: 'proctira-gateway',
  realm: 'proctira',
  jwksUri: `${issuer}/protocol/openid-connect/certs`,
};

function signed(payload: Record<string, unknown>, pem: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), pem).toString('base64url');
  return `${header}.${body}.${sig}`;
}

/** These tests exercise just-in-time provisioning (opt-in since PRC-H042). */
const JIT = { linkingMode: 'verified-email-jit' } as const;

describe('Keycloak identity projection (PRC-L283)', () => {
  beforeEach(() => {
    // Optional-call keeps the failing-first run meaningful on pre-fix code.
    (
      identityModule as { resetIdentityTouchThrottleForTests?: () => void }
    ).resetIdentityTouchThrottleForTests?.();
  });
  afterEach(() => vi.restoreAllMocks());

  async function appWith(identityStore: KeycloakIdentityStore) {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', kty: 'RSA' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const app = Fastify();
    await app.register(keycloakAuthPlugin, {
      config,
      identityStore,
      revocationStore: new MemoryAccessTokenRevocationStore(),
    });
    app.get('/protected', { preHandler: [app.authenticate] }, async (request) => ({
      tenantId: (request as unknown as { tenantId?: string }).tenantId,
    }));
    await app.ready();
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const now = Math.floor(Date.now() / 1000);
    const token = signed(
      {
        sub: 'kc-1',
        iss: issuer,
        azp: 'proctira-gateway',
        exp: now + 600,
        email: 'a@school.in',
        email_verified: true,
        tenant_id: 'tenant-claim',
        jti: 'j1',
        sid: 's1',
      },
      pem,
    );
    return { app, token };
  }

  it('identity store down -> 503, not a degraded principal', async () => {
    const down = new InMemoryKeycloakIdentityStore();
    down.findIdentity = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { app, token } = await appWith(down);
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('IDENTITY_UNAVAILABLE');
    await app.close();
  });

  it('identity mapping rejection -> 401', async () => {
    const store = new InMemoryKeycloakIdentityStore();
    store.findTenantById = vi.fn().mockResolvedValue(null);
    const { app, token } = await appWith(store);
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('concurrent first login yields a single user and identity', async () => {
    const store = new InMemoryKeycloakIdentityStore();
    const input = {
      externalId: 'kc-race',
      email: 'race@school.in',
      emailVerified: true,
      displayName: 'Race',
      tenantId: 'tenant-1',
      realm: 'proctira',
    };
    const results = await Promise.all([
      linkKeycloakIdentity(input, store, JIT),
      linkKeycloakIdentity(input, store, JIT),
      linkKeycloakIdentity(input, store, JIT),
    ]);
    expect(new Set(results.map((r) => r.userId)).size).toBe(1);
    const identity = await store.findIdentity('kc-race');
    expect(identity?.userId).toBe(results[0]!.userId);
  });

  it('touches lastUsedAt at most once per interval and never blocks on failure', async () => {
    const store = new InMemoryKeycloakIdentityStore();
    const input = {
      externalId: 'kc-touch',
      email: 't@school.in',
      emailVerified: true,
      displayName: 'T',
      tenantId: 'tenant-1',
      realm: 'proctira',
    };
    await linkKeycloakIdentity(input, store, JIT);
    const touch = vi.spyOn(store, 'touchIdentity').mockRejectedValue(new Error('write failed'));
    for (let i = 0; i < 5; i += 1) {
      await expect(linkKeycloakIdentity(input, store, JIT)).resolves.toMatchObject({
        tenantId: 'tenant-1',
      });
    }
    await new Promise((r) => setImmediate(r));
    expect(touch).toHaveBeenCalledTimes(1);
  });
});
