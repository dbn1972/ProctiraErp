/**
 * G-105: audit plugin is mounted and decorator is available.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60_000, maxRequests: 10_000 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-jwt-secret-at-least-32-characters-long',
      issuer: 'proctira-test',
      audience: 'proctira-api',
    },
    tenant: { baseDomain: 'localhost', headerName: 'x-tenant-id' },
    services: {},
  } as GatewayConfig;
}

describe('G-105 audit mount', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('decorates auditService on the gateway', () => {
    expect(app.auditService).toBeDefined();
    expect(typeof app.auditService.recordAudit).toBe('function');
    expect(typeof app.auditService.queryAuditLogs).toBe('function');
  });

  it('persists a recorded audit entry', async () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    await app.auditService.recordAudit({
      tenantId,
      entityType: 'student',
      entityId: 'stu-1',
      operation: 'CREATE',
      userId: 'user-1',
      userName: 'Tester',
      ipAddress: '127.0.0.1',
      afterValues: { name: 'Ada' },
    });

    const result = await app.auditService.queryAuditLogs({
      tenantId,
      entityType: 'student',
      page: 1,
      pageSize: 10,
    });

    const items = (result as { items?: unknown[]; data?: unknown[] }).items
      ?? (result as { data?: unknown[] }).data
      ?? [];
    expect(items.length).toBeGreaterThan(0);
  });
});
