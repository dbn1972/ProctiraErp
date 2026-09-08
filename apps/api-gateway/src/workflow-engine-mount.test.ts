/**
 * G-715 — the real @proctira/backend-workflow engine is mounted under
 * `/api/v1/workflow-engine` (in-memory here; Pg on db/sql/025 with DATABASE_URL).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440715';

function signToken(app: FastifyInstance, roleId: string): string {
  return app.jwt.sign({
    sub: `user-${roleId}`,
    tenantId: TENANT_ID,
    email: `${roleId}@example.com`,
    displayName: roleId,
    roles: [{ roleId, roleName: roleId, areaId: 'root' }],
    areas: [],
    institutions: [],
    jti: `jti-${roleId}`,
    sessionId: `session-${roleId}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
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
    },
  };
}

const definitionBody = {
  name: 'Transfer approval',
  entityType: 'student_transfer',
  states: [
    { id: 'draft', name: 'Draft', type: 'INITIAL', assigneeType: 'user', assigneeId: 'creator' },
    { id: 'review', name: 'Review', type: 'INTERMEDIATE', assigneeType: 'role', assigneeId: 'admin' },
    { id: 'done', name: 'Done', type: 'FINAL', assigneeType: 'role', assigneeId: 'admin' },
  ],
  transitions: [
    { id: 't1', fromStateId: 'draft', toStateId: 'review', action: 'submit' },
    { id: 't2', fromStateId: 'review', toStateId: 'done', action: 'approve' },
  ],
};

describe('G-715 workflow engine mount', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('definition → instance → transition → audit all respond through the gateway', async () => {
    const headers = { authorization: `Bearer ${signToken(app, 'admin')}`, 'x-tenant-id': TENANT_ID };

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-engine',
      headers,
      payload: definitionBody,
    });
    expect(created.statusCode).toBe(201);
    const definition = created.json() as { id: string };

    const listed = await app.inject({ method: 'GET', url: '/api/v1/workflow-engine', headers });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { meta: { totalItems: number } }).meta.totalItems).toBe(1);

    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-engine/instances',
      headers,
      payload: {
        workflowDefinitionId: definition.id,
        entityType: 'student_transfer',
        entityId: 'student-1',
      },
    });
    expect(started.statusCode).toBe(201);
    const instance = started.json() as { id: string };

    const transitioned = await app.inject({
      method: 'POST',
      url: `/api/v1/workflow-engine/instances/${instance.id}/transition`,
      headers,
      payload: { action: 'submit', actorId: 'user-admin' },
    });
    expect(transitioned.statusCode).toBe(200);
    expect((transitioned.json() as { currentStateId: string }).currentStateId).toBe('review');

    const audit = await app.inject({
      method: 'GET',
      url: `/api/v1/workflow-engine/instances/${instance.id}/audit`,
      headers,
    });
    expect(audit.statusCode).toBe(200);

    const cases = await app.inject({ method: 'GET', url: '/api/v1/workflow-engine/cases', headers });
    expect(cases.statusCode).toBe(200);
  });

  it('is RBAC-gated: anonymous → 401, guardian write → 403', async () => {
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/workflow-engine',
      headers: { 'x-tenant-id': TENANT_ID },
    });
    expect(anonymous.statusCode).toBe(401);

    const guardian = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-engine',
      headers: { authorization: `Bearer ${signToken(app, 'guardian')}`, 'x-tenant-id': TENANT_ID },
      payload: definitionBody,
    });
    expect(guardian.statusCode).toBe(403);
  });
});
