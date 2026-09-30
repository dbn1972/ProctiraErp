/**
 * PRC-H096: student photo/document uploads carry base64 bodies far above Fastify's 1 MiB
 * default, so they were rejected with 413 before reaching schema validation.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const STUDENT = '7a000000-0000-4000-8000-000000000001';

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
  };
}

describe('student upload body limits (PRC-H096)', () => {
  let app: FastifyInstance;
  const headers = () => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: 'admin-1',
      tenantId: TENANT,
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
      areas: [],
      institutions: [],
      jti: 'jti-upload',
      sessionId: 'session-upload',
    } as never)}`,
    'x-tenant-id': TENANT,
    'content-type': 'application/json',
  });

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('a 1.9 MB photo reaches the handler (not 413)', async () => {
    const raw = Buffer.alloc(Math.floor(1.9 * 1024 * 1024), 0xab);
    raw[0] = 0xff; // JPEG magic
    raw[1] = 0xd8;
    raw[2] = 0xff;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/students/${STUDENT}/photo`,
      headers: headers(),
      payload: { mimeType: 'image/jpeg', contentBase64: raw.toString('base64') },
    });
    expect(res.statusCode).not.toBe(413);
  });

  it('an 11 MB document gets a 400 schema answer, not 413', async () => {
    const raw = Buffer.alloc(11 * 1024 * 1024, 0x25);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/students/${STUDENT}/documents`,
      headers: headers(),
      payload: {
        documentType: 'birth_certificate',
        fileName: 'big.pdf',
        mimeType: 'application/pdf',
        contentBase64: raw.toString('base64'),
      },
    });
    // 11 MB raw -> ~14.7M base64 chars, over the 14M schema max: rejected by validation.
    expect(res.statusCode).toBe(400);
  });

  it('bodies beyond the route limit are still rejected with 413', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/students/${STUDENT}/photo`,
      headers: headers(),
      payload: { mimeType: 'image/jpeg', contentBase64: 'A'.repeat(5 * 1024 * 1024) },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('PAYLOAD_TOO_LARGE');
  });
});
