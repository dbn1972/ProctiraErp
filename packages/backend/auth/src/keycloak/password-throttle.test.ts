import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PasswordLoginThrottle } from './password-throttle.js';
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

  it('unlocks after the lock period elapses', () => {
    let now = 1_000_000;
    const throttle = new PasswordLoginThrottle({
      maxAccountFailures: 2,
      lockSeconds: 60,
      now: () => now,
    });
    throttle.recordFailure('a@b.in', '1.1.1.1');
    throttle.recordFailure('a@b.in', '1.1.1.2');
    expect(throttle.check('a@b.in', '9.9.9.9').allowed).toBe(false);
    now += 61_000;
    expect(throttle.check('a@b.in', '9.9.9.9').allowed).toBe(true);
  });

  it('keeps memory bounded', () => {
    const throttle = new PasswordLoginThrottle({ maxTrackedKeys: 10 });
    for (let i = 0; i < 100; i += 1) throttle.recordFailure(`u${i}`, `10.0.${i}.1`);
    expect(
      (throttle as unknown as { buckets: Map<string, unknown> }).buckets.size,
    ).toBeLessThanOrEqual(10);
  });
});
