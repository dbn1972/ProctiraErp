/**
 * The gateway must boot in Keycloak mode.
 *
 * ## The bug
 *
 * `rbacPlugin` declares `dependencies: ['@proctira/backend-auth']`. That name belongs to
 * `authPlugin`, the local HS-JWT fallback. In Keycloak mode `app.ts` registers
 * `keycloakAuthPlugin` instead, which was named `proctira-keycloak-auth`, so the declared
 * dependency was never registered and Fastify refused to boot:
 *
 *     FST_ERR_PLUGIN_DEPENDENCY_NOT_REGISTERED: The dependency '@proctira/backend-auth'
 *     of plugin '@proctira/rbac' is not registered
 *
 * Keycloak is the platform IdP per ADR-001 and local HS-JWT is documented as "a CI/headless
 * fallback only — not an alternate product IdP". So the gateway booted only in its fallback
 * mode, and every test covered that mode. Nothing exercised the supported one.
 *
 * ## What this pins
 *
 * That the app builds with `KEYCLOAK_*` set, and that the two auth plugins are
 * interchangeable from RBAC's point of view — they are alternative implementations of one
 * capability, which is what a shared Fastify plugin name is for.
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

function config(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 1000 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  } as unknown as GatewayConfig;
}

const KEYCLOAK_ENV = {
  KEYCLOAK_ISSUER: 'https://keycloak.test/realms/proctira',
  KEYCLOAK_CLIENT_ID: 'proctira-gateway',
  KEYCLOAK_CLIENT_SECRET: 'test-secret',
} as const;

describe('gateway boot in Keycloak mode', () => {
  let app: FastifyInstance | undefined;
  const saved: Record<string, string | undefined> = {};

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function withKeycloakEnv(): void {
    for (const [key, value] of Object.entries(KEYCLOAK_ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  }

  it('builds with KEYCLOAK_* set, so rbacPlugin finds its auth dependency', async () => {
    withKeycloakEnv();

    // The failure mode was a rejected build, not a bad response, so building *is* the
    // assertion. Before the fix this rejected with
    // FST_ERR_PLUGIN_DEPENDENCY_NOT_REGISTERED.
    app = await buildApp({ config: config() });
    await app.ready();

    expect(app.hasRequestDecorator('user')).toBe(true);
    // Discriminate the branch. `hasRequestDecorator('user')` is true in both modes, so on
    // its own it cannot tell which one ran: if `loadKeycloakAuthConfig` ever required a
    // further env var, this test would silently exercise the HS-JWT fallback and still
    // pass — the failure class it exists to prevent. The OIDC callback route exists only
    // in Keycloak mode; `app.jwt` exists only in the fallback, because only `authPlugin`
    // registers @fastify/jwt.
    expect(app.hasRoute({ method: 'GET', url: '/api/v1/auth/callback' })).toBe(true);
    expect((app as unknown as { jwt?: unknown }).jwt).toBeUndefined();
  });

  it('enforces the auth boundary in Keycloak mode', async () => {
    withKeycloakEnv();
    app = await buildApp({ config: config() });
    await app.ready();

    // Booting was the bug; this is the reason booting matters. The gateway's global
    // onRequest hook does its own path exclusion and calls request.jwtVerify() in this
    // mode, a branch that was unreachable in production until now.
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/services' })).statusCode).toBe(401);
    const junk = await app.inject({
      method: 'GET',
      url: '/api/v1/services',
      headers: { authorization: 'Bearer not-a-token' },
    });
    expect(junk.statusCode).toBe(401);
  });

  it('still builds without KEYCLOAK_*, on the local HS-JWT fallback', async () => {
    for (const key of Object.keys(KEYCLOAK_ENV)) {
      saved[key] = process.env[key];
      delete process.env[key];
    }

    app = await buildApp({ config: config() });
    await app.ready();

    expect(app.hasRequestDecorator('user')).toBe(true);
    // The inverse of the discriminators above, so neither test can pass by accident in
    // the other mode.
    expect(app.hasRoute({ method: 'GET', url: '/api/v1/auth/callback' })).toBe(false);
    expect((app as unknown as { jwt?: unknown }).jwt).toBeDefined();
  });
});
