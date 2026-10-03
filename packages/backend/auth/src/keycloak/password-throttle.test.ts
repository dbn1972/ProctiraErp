import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MemoryPasswordThrottleState,
  PasswordLoginThrottle,
  RedisPasswordThrottleState,
  createPasswordThrottleState,
  decidePasswordThrottleStore,
} from './password-throttle.js';
import { registerKeycloakAuthRoutes } from './routes.js';

const baseConfig = {
  issuer: 'http://localhost:8180/realms/proctira',
  clientId: 'proctira-gateway',
  realm: 'proctira',
  jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
  redirectUri: 'http://localhost:3200/api/v1/auth/callback',
};

function badCredentials(): Response {
  return new Response(JSON.stringify({ error: 'invalid_grant' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

async function buildApp(throttle: PasswordLoginThrottle) {
  const app = Fastify({ trustProxy: true });
  await registerKeycloakAuthRoutes(app, { ...baseConfig, passwordThrottle: throttle });
  return app;
}

function login(app: Awaited<ReturnType<typeof buildApp>>, username: string, ip: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/password',
    headers: { 'x-forwarded-for': ip },
    payload: { username, password: 'wrong' },
  });
}

describe('POST /auth/password failed-attempt limiting (PRC-H043)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('locks one username after N failures regardless of source IP', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => badCredentials());
    const app = await buildApp(
      new PasswordLoginThrottle({ maxAccountFailures: 3, maxIpFailures: 100 }),
    );

    for (let i = 0; i < 3; i += 1) {
      const res = await login(app, 'Admin@proctira.in', `10.0.0.${i + 1}`);
      expect(res.statusCode).toBe(401);
    }
    const locked = await login(app, 'admin@proctira.in', '10.0.0.99');
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
    // Locked requests never reach Keycloak.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await app.close();
  });

  it('locks one IP spraying many accounts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => badCredentials());
    const app = await buildApp(
      new PasswordLoginThrottle({ maxAccountFailures: 100, maxIpFailures: 4 }),
    );
    for (let i = 0; i < 4; i += 1) {
      expect((await login(app, `user${i}@proctira.in`, '192.0.2.7')).statusCode).toBe(401);
    }
    expect((await login(app, 'fresh@proctira.in', '192.0.2.7')).statusCode).toBe(429);
    expect((await login(app, 'fresh@proctira.in', '192.0.2.8')).statusCode).toBe(401);
    await app.close();
  });

  it('does not count IdP outages as failed credentials', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('down', { status: 503 }),
    );
    const app = await buildApp(new PasswordLoginThrottle({ maxAccountFailures: 2 }));
    for (let i = 0; i < 5; i += 1) {
      expect((await login(app, 'admin@proctira.in', '10.0.0.1')).statusCode).toBe(401);
    }
    await app.close();
  });

  it('unlocks after the lock period elapses', async () => {
    let now = 1_000_000;
    const throttle = new PasswordLoginThrottle({
      maxAccountFailures: 2,
      lockSeconds: 60,
      now: () => now,
    });
    await throttle.recordFailure('a@b.in', '1.1.1.1');
    await throttle.recordFailure('a@b.in', '1.1.1.2');
    expect((await throttle.check('a@b.in', '9.9.9.9')).allowed).toBe(false);
    now += 61_000;
    expect((await throttle.check('a@b.in', '9.9.9.9')).allowed).toBe(true);
  });
  it('keeps memory bounded', async () => {
    const state = new MemoryPasswordThrottleState({ maxTrackedKeys: 10 });
    const throttle = new PasswordLoginThrottle({ state });
    for (let i = 0; i < 100; i += 1) await throttle.recordFailure(`u${i}`, `10.0.${i}.1`);
    expect(
      (state as unknown as { buckets: Map<string, unknown> }).buckets.size,
    ).toBeLessThanOrEqual(10);
  });
});

describe('PRC-H043 shared throttle state across replicas', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a lock earned on one replica holds on another sharing the store', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => badCredentials());
    const shared = new MemoryPasswordThrottleState();
    const replicaA = await buildApp(
      new PasswordLoginThrottle({ maxAccountFailures: 4, state: shared }),
    );
    const replicaB = await buildApp(
      new PasswordLoginThrottle({ maxAccountFailures: 4, state: shared }),
    );
    // Alternate replicas, as a load balancer would: 2 + 2 failures reach the budget of 4.
    for (let i = 0; i < 4; i += 1) {
      const app = i % 2 === 0 ? replicaA : replicaB;
      expect((await login(app, 'victim@proctira.in', `10.1.0.${i}`)).statusCode).toBe(401);
    }
    expect((await login(replicaA, 'victim@proctira.in', '10.1.0.50')).statusCode).toBe(429);
    expect((await login(replicaB, 'victim@proctira.in', '10.1.0.51')).statusCode).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await replicaA.close();
    await replicaB.close();
  });

  it('fails closed (503, IdP never called) when the shared store is unavailable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const broken = {
      lockRemainingMs: async () => {
        throw new Error('ECONNREFUSED');
      },
      recordFailure: async () => undefined,
      clear: async () => undefined,
    };
    const app = await buildApp(new PasswordLoginThrottle({ state: broken }));
    const res = await login(app, 'admin@proctira.in', '10.0.0.1');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'LOGIN_THROTTLE_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('production refuses the process-local store; a shared redis client selects Redis', () => {
    expect(() => createPasswordThrottleState({ NODE_ENV: 'production' })).toThrow(/PRC-H043/);
    expect(decidePasswordThrottleStore({ NODE_ENV: 'test' }).mode).toBe('memory');
    const redis = { eval: vi.fn(), pttl: vi.fn(), del: vi.fn() };
    expect(createPasswordThrottleState({ redis, NODE_ENV: 'production' })).toBeInstanceOf(
      RedisPasswordThrottleState,
    );
  });

  it('Redis store: atomic script per failure, hashed keys, lock read via PTTL', async () => {
    const redis = {
      eval: vi.fn().mockResolvedValue(1),
      pttl: vi.fn().mockResolvedValue(42_000),
      del: vi.fn().mockResolvedValue(2),
    };
    const throttle = new PasswordLoginThrottle({
      maxAccountFailures: 5,
      maxIpFailures: 20,
      windowSeconds: 900,
      lockSeconds: 600,
      state: new RedisPasswordThrottleState(redis),
    });
    await throttle.recordFailure('Victim@Proctira.in', '10.0.0.1');
    expect(redis.eval).toHaveBeenCalledTimes(2);
    const [script, numKeys, failKey, lockKey, windowMs, limit, lockMs] = redis.eval.mock.calls[0]!;
    expect(script).toContain("redis.call('INCR', KEYS[1])");
    expect(numKeys).toBe(2);
    expect([windowMs, limit, lockMs]).toEqual([900_000, 5, 600_000]);
    expect(String(failKey)).toMatch(/^auth:pwthrottle:fail:[0-9a-f]{64}$/);
    expect(String(lockKey)).toMatch(/^auth:pwthrottle:lock:[0-9a-f]{64}$/);
    expect(String(failKey)).not.toContain('victim');
    const decision = await throttle.check('victim@proctira.in', '10.0.0.9');
    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 42 });
    await throttle.recordSuccess('victim@proctira.in');
    expect(redis.del).toHaveBeenCalledTimes(1);
  });
});
