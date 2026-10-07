/**
 * PRC-H066 — gateway wiring: grade writes mounted by the gradebook domain registrar run the
 * section-scope checks with the authenticated principal (not just the role gate).
 *
 * The hermetic gateway composes in-memory repositories, so no section exists: an entry without
 * sectionId is rejected (400) and an unknown section is 404 rather than a silent unscoped write.
 */
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

// Keep the gateway on in-memory repositories (see gateway-integration.test.ts).
delete process.env['DATABASE_URL'];

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

function config(): GatewayConfig {
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
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  } as unknown as GatewayConfig;
}

function payload(roleId: string) {
  return {
    sub: `user-${roleId}`,
    tenantId: TENANT,
    email: `${roleId}@example.com`,
    displayName: roleId,
    roles: [{ roleId, roleName: roleId, areaId: null }],
    areas: [],
    institutions: [],
    jti: `jti-${roleId}`,
    sessionId: `session-${roleId}`,
  };
}

describe('PRC-H066 gradebook grade-write scope (gateway wiring)', () => {
  it('rejects section-less entries and unknown sections through the mounted domain', async () => {
    const app = await buildApp({ config: config() });
    await app.ready();
    try {
      for (const roleId of ['admin', 'teacher']) {
        const headers = {
          authorization: `Bearer ${app.jwt.sign(payload(roleId))}`,
          'x-tenant-id': TENANT,
          'content-type': 'application/json',
        };
        const noSection = await app.inject({
          method: 'PUT',
          url: '/api/v1/gradebook/entries',
          headers,
          payload: { studentId: '33333333-3333-4333-8333-333333333333', numericScore: 90 },
        });
        expect(noSection.statusCode, `${roleId}: ${noSection.body}`).toBe(400);
        expect(noSection.json().message).toMatch(/sectionId is required/);

        const unknownSection = await app.inject({
          method: 'PUT',
          url: '/api/v1/gradebook/entries',
          headers,
          payload: {
            sectionId: '44444444-4444-4444-8444-444444444444',
            studentId: '33333333-3333-4333-8333-333333333333',
            numericScore: 90,
          },
        });
        expect(unknownSection.statusCode, `${roleId}: ${unknownSection.body}`).toBe(404);
      }
    } finally {
      await app.close();
    }
  });
});
