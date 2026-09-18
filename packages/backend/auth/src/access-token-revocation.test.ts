/**
 * W1-SEC-09 — access-token jti/sid revocation unit tests.
 * COMPLETE: production shared-store fail-closed + multi-replica logout.
 */
import { createAuthConfig } from '@proctira/auth';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertAccessTokenNotRevoked,
  createAccessTokenRevocationStore,
  decideAccessTokenRevocationStore,
  MemoryAccessTokenRevocationStore,
  RedisAccessTokenRevocationStore,
  revokeAccessTokenIdentifiers,
  type RedisLikeForAccessTokenRevocation,
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

describe('decideAccessTokenRevocationStore / createAccessTokenRevocationStore (W1-SEC-09 COMPLETE)', () => {
  it('prefers Redis when a shared client is injected', () => {
    const redis: RedisLikeForAccessTokenRevocation = {
      set: async () => 'OK',
      exists: async () => 0,
    };
    expect(
      decideAccessTokenRevocationStore({
        NODE_ENV: 'production',
        redis,
      }),
    ).toEqual({ mode: 'redis', reason: 'shared redis client injected (cluster-wide)' });
    expect(createAccessTokenRevocationStore({ redis, NODE_ENV: 'production' })).toBeInstanceOf(
      RedisAccessTokenRevocationStore,
    );
  });

  it('allows in-memory in non-production when redis is unset', () => {
    expect(decideAccessTokenRevocationStore({ NODE_ENV: 'development' })).toEqual({
      mode: 'memory',
      reason: 'redis unset (dev/test process-local store)',
    });
    expect(decideAccessTokenRevocationStore({ NODE_ENV: 'test' }).mode).toBe('memory');
    expect(createAccessTokenRevocationStore({ NODE_ENV: 'test' })).toBeInstanceOf(
      MemoryAccessTokenRevocationStore,
    );
  });

  it('refuses silent multi-replica memory in production without redis', () => {
    expect(() => decideAccessTokenRevocationStore({ NODE_ENV: 'production' })).toThrow(
      /Shared access-token revocation store \(REDIS_URL \/ redis\) is required in production \(W1-SEC-09\)/,
    );
    expect(() => createAccessTokenRevocationStore({ NODE_ENV: 'production' })).toThrow(/W1-SEC-09/);
  });

  it('no longer honours an env escape hatch for in-memory production revocation', () => {
    // ALLOW_IN_MEMORY_ACCESS_TOKEN_REVOCATION previously downgraded production to
    // a process-local denylist. On multi-replica deployments that silently broke
    // logout: revoking on one replica left the stolen access token valid on the
    // others until TTL. Sharedness is now a store capability, not an env opt-out.
    for (const value of ['1', 'true', 'yes', 'on']) {
      expect(() =>
        decideAccessTokenRevocationStore({
          NODE_ENV: 'production',
          ALLOW_IN_MEMORY_ACCESS_TOKEN_REVOCATION: value,
        } as Parameters<typeof decideAccessTokenRevocationStore>[0]),
      ).toThrow(/W1-SEC-09/);
      expect(() =>
        createAccessTokenRevocationStore({
          NODE_ENV: 'production',
          ALLOW_IN_MEMORY_ACCESS_TOKEN_REVOCATION: value,
        } as Parameters<typeof createAccessTokenRevocationStore>[0]),
      ).toThrow(/W1-SEC-09/);
    }
  });

  it('marks only cluster-visible stores as shared', () => {
    const redis: RedisLikeForAccessTokenRevocation = {
      set: async () => 'OK',
      exists: async () => 0,
    };
    expect(new MemoryAccessTokenRevocationStore().shared).toBe(false);
    expect(new RedisAccessTokenRevocationStore(redis).shared).toBe(true);
    expect(createAccessTokenRevocationStore({ redis, NODE_ENV: 'production' }).shared).toBe(true);
    expect(createAccessTokenRevocationStore({ NODE_ENV: 'test' }).shared).toBe(false);
  });
});

describe('RedisAccessTokenRevocationStore (shared mock)', () => {
  function createMockRedis(): RedisLikeForAccessTokenRevocation & {
    data: Map<string, { value: string; exp: number }>;
  } {
    const data = new Map<string, { value: string; exp: number }>();
    return {
      data,
      async set(key: string, value: string, ...args: Array<string | number>) {
        let ttlSeconds = 60;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === 'EX' && typeof args[i + 1] === 'number') {
            ttlSeconds = args[i + 1] as number;
          }
        }
        data.set(key, { value, exp: Date.now() + ttlSeconds * 1000 });
        return 'OK';
      },
      async exists(...keys: string[]) {
        const now = Date.now();
        let n = 0;
        for (const key of keys) {
          const entry = data.get(key);
          if (entry && entry.exp > now) n += 1;
        }
        return n;
      },
    };
  }

  it('revokes and checks via Redis SET EX / EXISTS', async () => {
    const redis = createMockRedis();
    const store = new RedisAccessTokenRevocationStore(redis);
    await store.revoke('jti', 'j-redis', 90);
    expect(await store.isRevoked('jti', 'j-redis')).toBe(true);
    expect(await store.isRevoked('sid', 's-missing')).toBe(false);
    expect(redis.data.has('auth:access-revoke:jti:j-redis')).toBe(true);
  });

  it('propagates Redis errors so callers fail closed', async () => {
    const broken: RedisLikeForAccessTokenRevocation = {
      set: async () => {
        throw new Error('redis down');
      },
      exists: async () => {
        throw new Error('redis down');
      },
    };
    const store = new RedisAccessTokenRevocationStore(broken);
    await expect(store.revoke('jti', 'x', 10)).rejects.toThrow(/redis down/);
    await expect(store.isRevoked('jti', 'x')).rejects.toThrow(/redis down/);
    const check = await assertAccessTokenNotRevoked({ jti: 'x' }, { store, nodeEnv: 'production' });
    expect(check).toEqual({ ok: false, reason: 'store_unavailable' });
  });
});

describe('multi-replica logout with shared revocation store (W1-SEC-09 COMPLETE)', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function mountReplica(
    store: MemoryAccessTokenRevocationStore | RedisAccessTokenRevocationStore,
  ) {
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
    return app;
  }

  it('logout on replica A revokes the bearer on replica B when the store is shared', async () => {
    // Shared MemoryAccessTokenRevocationStore stands in for Redis across replicas.
    const shared = new MemoryAccessTokenRevocationStore();
    const replicaA = await mountReplica(shared);
    const replicaB = await mountReplica(shared);

    const token = replicaA.jwt.sign({
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'a@example.com',
      displayName: 'A',
      roles: [],
      areas: [],
      institutions: [],
      jti: 'jti-shared-logout',
      sessionId: 'sid-shared-logout',
    });

    const before = await replicaB.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    // Replica A performs logout-equivalent denylist write (jti + sid).
    await revokeAccessTokenIdentifiers(
      shared,
      { jti: 'jti-shared-logout', sessionId: 'sid-shared-logout' },
      900,
    );

    const after = await replicaB.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({
      code: 'TOKEN_REVOKED',
      reason: 'revoked_jti',
    });
  });

  it('logout propagates via shared Redis mock across two replicas', async () => {
    const data = new Map<string, { value: string; exp: number }>();
    const redis: RedisLikeForAccessTokenRevocation = {
      async set(key: string, value: string, ...args: Array<string | number>) {
        let ttlSeconds = 60;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === 'EX' && typeof args[i + 1] === 'number') {
            ttlSeconds = args[i + 1] as number;
          }
        }
        data.set(key, { value, exp: Date.now() + ttlSeconds * 1000 });
        return 'OK';
      },
      async exists(...keys: string[]) {
        const now = Date.now();
        return keys.filter((key) => {
          const entry = data.get(key);
          return entry && entry.exp > now;
        }).length;
      },
    };
    const shared = new RedisAccessTokenRevocationStore(redis);
    const replicaA = await mountReplica(shared);
    const replicaB = await mountReplica(shared);

    const token = replicaA.jwt.sign({
      sub: 'user-2',
      tenantId: 'tenant-1',
      email: 'b@example.com',
      displayName: 'B',
      roles: [],
      areas: [],
      institutions: [],
      jti: 'jti-redis-logout',
      sessionId: 'sid-redis-logout',
    });

    expect(
      (
        await replicaB.inject({
          method: 'GET',
          url: '/protected',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(200);

    await revokeAccessTokenIdentifiers(
      shared,
      { jti: 'jti-redis-logout', sessionId: 'sid-redis-logout' },
      900,
    );

    const denied = await replicaB.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({ code: 'TOKEN_REVOKED', reason: 'revoked_jti' });
  });

  it('process-local stores do not share logout (documents why prod forbids memory)', async () => {
    const storeA = new MemoryAccessTokenRevocationStore();
    const storeB = new MemoryAccessTokenRevocationStore();
    const replicaA = await mountReplica(storeA);
    const replicaB = await mountReplica(storeB);

    const token = replicaA.jwt.sign({
      sub: 'user-3',
      tenantId: 'tenant-1',
      email: 'c@example.com',
      displayName: 'C',
      roles: [],
      areas: [],
      institutions: [],
      jti: 'jti-local-only',
      sessionId: 'sid-local-only',
    });

    await revokeAccessTokenIdentifiers(
      storeA,
      { jti: 'jti-local-only', sessionId: 'sid-local-only' },
      900,
    );

    // Replica A rejects; replica B still accepts — inconsistent multi-replica logout.
    expect(
      (
        await replicaA.inject({
          method: 'GET',
          url: '/protected',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await replicaB.inject({
          method: 'GET',
          url: '/protected',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(200);
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
