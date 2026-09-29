/**
 * POST /api/v1/institutions/:id/reactivate
 *
 * Gateway proof: institution:update, INACTIVE → ACTIVE, already-active 422,
 * cross-tenant 404, parent 403, and an audit row with actor, reason, and
 * before/after status. Deactivate does not publish an outbox event, so this
 * route does not either.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_TENANT_ID = '660e8400-e29b-41d4-a716-446655440001';

function createTestJwtPayload(overrides?: Record<string, unknown>) {
  return {
    sub: 'user-reactivate',
    tenantId: TENANT_ID,
    email: 'priya.sharma@school.edu',
    displayName: 'Priya Sharma',
    roles: [
      {
        roleId: 'principal',
        roleName: 'Principal',
        areaId: 'root',
      },
    ],
    areas: [],
    institutions: [],
    jti: 'test-jti-reactivate',
    sessionId: 'test-session-reactivate',
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function createTestConfig(): GatewayConfig {
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
      institutions: {
        prefix: '/institutions',
        target: 'http://localhost:3002',
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

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

describe('POST /api/v1/institutions/:id/reactivate', () => {
  let app: FastifyInstance;
  let principal: string;
  let admin: string;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
    principal = app.jwt.sign(createTestJwtPayload());
    admin = app.jwt.sign(
      createTestJwtPayload({
        sub: 'admin-reactivate',
        displayName: 'School Admin',
        roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'root' }],
        jti: 'test-jti-reactivate-admin',
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function createInstitution(code: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/institutions',
      headers: authHeaders(admin),
      payload: {
        name: `Reactivate School ${code}`,
        code,
        areaId: '11111111-1111-4111-8111-111111111111',
        typeId: '22222222-2222-4222-8222-222222222222',
        sectorId: '33333333-3333-4333-8333-333333333333',
        ownershipId: '44444444-4444-4444-8444-444444444444',
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().id as string;
  }

  async function deactivate(id: string, reason: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/institutions/${id}/deactivate`,
      headers: authHeaders(principal),
      payload: { reason },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().status).toBe('INACTIVE');
  }

  it('reactivates an inactive institution and writes an audit row', async () => {
    const id = await createInstitution(`REACT-${Date.now()}`);
    await deactivate(id, 'Wing paused');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/institutions/${id}/reactivate`,
      headers: authHeaders(principal),
      payload: { reason: 'Wing reopened' },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().status).toBe('ACTIVE');
    expect(response.json().deactivationReason).toBeNull();

    const logs = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      entityType: 'institution',
      entityId: id,
      page: 1,
      pageSize: 20,
    });
    const row = logs.data.find(
      (entry) =>
        entry.metadata &&
        (entry.metadata as { action?: string }).action === 'institution.reactivate',
    );
    expect(row).toBeTruthy();
    expect(row?.userId).toBe('user-reactivate');
    expect(row?.userName).toBe('Priya Sharma');
    expect(row?.beforeValues).toMatchObject({
      status: 'INACTIVE',
      deactivationReason: 'Wing paused',
    });
    expect(row?.afterValues).toMatchObject({
      status: 'ACTIVE',
      deactivationReason: null,
      reason: 'Wing reopened',
    });
    expect(row?.metadata).toMatchObject({
      action: 'institution.reactivate',
      reason: 'Wing reopened',
      actorId: 'user-reactivate',
    });
  });

  it('returns 422 BUSINESS_RULE_ERROR when the institution is already active', async () => {
    const id = await createInstitution(`REACT-ACTIVE-${Date.now()}`);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/institutions/${id}/reactivate`,
      headers: authHeaders(principal),
      payload: { reason: 'Already open' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('BUSINESS_RULE_ERROR');
    expect(response.json().message).toMatch(/already active/i);
  });

  it('returns 404 for an institution in another tenant', async () => {
    const id = await createInstitution(`REACT-TENANT-${Date.now()}`);
    await deactivate(id, 'Paused');

    const other = app.jwt.sign(
      createTestJwtPayload({
        sub: 'other-tenant-principal',
        tenantId: OTHER_TENANT_ID,
        jti: 'test-jti-reactivate-other',
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/institutions/${id}/reactivate`,
      headers: authHeaders(other),
      payload: { reason: 'Cross tenant' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('NOT_FOUND');
  });

  it('returns 403 for a parent', async () => {
    const parent = app.jwt.sign(
      createTestJwtPayload({
        sub: 'parent-user',
        roles: [{ roleId: 'parent', roleName: 'Parent', areaId: 'root' }],
        jti: 'test-jti-reactivate-parent',
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/institutions/55555555-5555-4555-8555-555555555555/reactivate',
      headers: authHeaders(parent),
      payload: { reason: 'Parent attempt' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  });
});
