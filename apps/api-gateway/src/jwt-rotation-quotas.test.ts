/**
 * G-504 JWT dual-key rotation + G-505 per-tenant plan quotas (integration).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import {
  clearTenantPlanTiersForTests,
  setTenantPlanTierForTests,
} from './tenant-plan-quotas.js';

const CURRENT_SECRET = 'rotation-current-secret';
const PREVIOUS_SECRET = 'rotation-previous-secret';
const TENANT_FREE = '550e8400-e29b-41d4-a716-4466554400f1';
const TENANT_ENT = '550e8400-e29b-41d4-a716-4466554400e1';

function createTestJwtPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    tenantId: TENANT_FREE,
    email: 'user@example.com',
    displayName: 'User',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'root' }],
    areas: [],
    institutions: [],
    jti: 'jti-1',
    sessionId: 'session-1',
    ...overrides,
  };
}

function createTestConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 3000,
    host: '0.0.0.0',
    env: 'test',
    rateLimiting: { windowMs: 60_000, maxRequests: 100 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: CURRENT_SECRET,
      previousSecret: PREVIOUS_SECRET,
      issuer: 'proctira-platform',
      audience: 'proctira-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: {
      baseDomain: 'proctira.org',
      headerName: 'x-tenant-id',
    },
    services: {},
    ...overrides,
  };
}

describe('G-504 JWT dual-key rotation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts tokens signed with the current secret', async () => {
    const token = app.jwt.sign(createTestJwtPayload());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/institutions',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_FREE,
      },
    });
    expect(response.statusCode).not.toBe(401);
  });

  it('accepts tokens signed with the previous secret during rotation', async () => {
    const token = app.jwt.sign(createTestJwtPayload(), { key: PREVIOUS_SECRET });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/institutions',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_FREE,
      },
    });
    expect(response.statusCode).not.toBe(401);
  });

  it('rejects tokens signed with an unknown secret', async () => {
    const token = app.jwt.sign(createTestJwtPayload(), { key: 'totally-wrong-secret' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/institutions',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_FREE,
      },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('G-505 per-tenant plan rate quotas', () => {
  beforeEach(() => {
    clearTenantPlanTiersForTests();
  });

  it('returns 429 for free-tier tenant after quota while enterprise continues', async () => {
    setTenantPlanTierForTests(TENANT_FREE, 'free');
    setTenantPlanTierForTests(TENANT_ENT, 'enterprise');

    const app = await buildApp({
      config: createTestConfig({
        // Fallback unused when tiers resolve; keep window large.
        rateLimiting: { windowMs: 60_000, maxRequests: 50 },
      }),
    });
    await app.ready();

    try {
      const freeToken = app.jwt.sign(
        createTestJwtPayload({
          sub: 'free-user',
          tenantId: TENANT_FREE,
          planTier: 'free',
        }),
      );
      const entToken = app.jwt.sign(
        createTestJwtPayload({
          sub: 'ent-user',
          tenantId: TENANT_ENT,
          planTier: 'enterprise',
        }),
      );

      // free tier quota = 100; drive just past it
      let lastFreeStatus = 200;
      for (let i = 0; i < 101; i++) {
        const res = await app.inject({
          method: 'GET',
          url: '/health',
          headers: {
            authorization: `Bearer ${freeToken}`,
            'x-tenant-id': TENANT_FREE,
          },
        });
        lastFreeStatus = res.statusCode;
      }
      expect(lastFreeStatus).toBe(429);

      // enterprise tenant uses a different key — must not be blocked by free tenant
      const entRes = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          authorization: `Bearer ${entToken}`,
          'x-tenant-id': TENANT_ENT,
        },
      });
      expect(entRes.statusCode).toBe(200);
      expect(entRes.headers['x-ratelimit-limit']).toBeDefined();
    } finally {
      await app.close();
    }
  }, 60_000);
});
