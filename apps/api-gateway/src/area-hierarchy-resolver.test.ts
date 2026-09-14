/**
 * W1-ARCH-04 (D6) — gateway must compose a tenant-scoped area hierarchy resolver.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  asTenantScopedResolver,
  demoGatewayAreaHierarchy,
  GATEWAY_DEMO_TENANT_ID,
} from '@proctira/backend-institution';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 100 },
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
      auth: {
        prefix: '/auth',
        target: 'http://127.0.0.1:1',
        healthCheck: '/health',
      },
    },
  };
}

describe('W1-ARCH-04 (D6) gateway area hierarchy resolver', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mounts tenant-scoped resolver instead of a single hardcoded root node', async () => {
    const scoped = asTenantScopedResolver(app.rbacAreaResolver);
    expect(scoped).toBeDefined();
    expect(scoped!.isHardcodedRootOnly()).toBe(false);

    const [, state, district] = demoGatewayAreaHierarchy();
    await scoped!.ensureTenantLoaded(GATEWAY_DEMO_TENANT_ID);
    expect(await scoped!.isDescendantOrSelf(district.id, state.id)).toBe(true);
  });
});
