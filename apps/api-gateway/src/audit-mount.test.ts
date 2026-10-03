/**
 * G-105: audit plugin is mounted; mutating /api/v1 calls produce audit rows.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { signTestToken } from './__tests__/gateway-test-kit.js';
import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';


function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: {
      windowMs: 60000,
      maxRequests: 1000,
    },
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
    tenant: {
      baseDomain: 'proctira.org',
      headerName: 'x-tenant-id',
    },
    services: {
      auth: {
        prefix: '/auth',
        target: 'http://127.0.0.1:1',
        healthCheck: '/health',
      },
      students: {
        prefix: '/students',
        target: 'http://localhost:3003',
        healthCheck: '/health',
      },
    },
  };
}

describe('G-105 audit mount', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('decorates auditService on the gateway', () => {
    expect(app.auditService).toBeDefined();
    expect(typeof app.auditService.recordAudit).toBe('function');
    expect(typeof app.auditService.queryAuditLogs).toBe('function');
  });

  it('mounts billingService and tenantService (G-106 packages)', () => {
    expect(app.billingService).toBeDefined();
    expect(app.tenantService).toBeDefined();
  });

  it('records an audit row on a successful mutating API call (resolved entity id, PRC-M013)', async () => {
    const token = signTestToken(app, { sub: 'user-123', tenantId: TENANT_ID, roles: ['admin'] });
    const headers = {
      authorization: `Bearer ${token}`,
      'x-tenant-id': TENANT_ID,
      'content-type': 'application/json',
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/definitions',
      headers,
      payload: {
        name: 'Audit mount chain',
        module: 'fees',
        steps: [{ name: 'Review', approverRole: 'PRINCIPAL' }],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const createdId = (response.json() as { id: string }).id;
    const after = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });
    const row = after.data.find((r) => r.entityId === createdId);
    expect(row, JSON.stringify(after.data.map((r) => r.entityId))).toBeDefined();
    expect(row!.operation).toBe('CREATE');
    expect(row!.userId).toBe('user-123');
    expect(row!.metadata).toMatchObject({ outcome: 'success', statusCode: 201 });
    expect((row!.afterValues as { changedFields?: string[] }).changedFields).toEqual([
      'module',
      'name',
      'steps',
    ]);
  });

  it('a 400 response does not create a CREATE audit row (PRC-M013)', async () => {
    const token = signTestToken(app, { sub: 'user-123', tenantId: TENANT_ID, roles: ['admin'] });
    const before = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/definitions',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      payload: { name: '' },
    });
    expect(response.statusCode).toBe(400);
    const after = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });
    expect(after.data.length).toBe(before.data.length);
  });
});
