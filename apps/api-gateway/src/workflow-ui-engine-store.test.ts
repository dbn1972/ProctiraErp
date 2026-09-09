/**
 * G-924 — one workflow store: the redesign `/workflows/*` aggregates and the
 * `/workflow-engine` API read and write the same definitions, instances and
 * transitions. A definition created through the UI shape is a real engine
 * definition; approving through the UI produces an engine transition audit row.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import {
  APPROVED_STATE_ID,
  REJECTED_STATE_ID,
  engineToSteps,
  stepsToEngine,
} from './workflow-ui-engine-store.js';
import {
  WORKFLOW_DEF_TRANSFER_ID,
  WORKFLOW_DEMO_TENANT_ID,
  WORKFLOW_INSTANCE_PENDING_ID,
} from './workflow-ui-seed.js';

delete process.env['DATABASE_URL'];

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

describe('step ↔ engine mapping', () => {
  it('round-trips a linear approval chain', () => {
    const steps = [
      { id: 's1', order: 1, name: 'Principal review', approverRole: 'PRINCIPAL' },
      { id: 's2', order: 2, name: 'District approval', approverRole: 'DISTRICT_ADMIN' },
    ];
    const { states, transitions } = stepsToEngine(steps);
    expect(states.map((s) => s.id)).toEqual(['s1', 's2', APPROVED_STATE_ID, REJECTED_STATE_ID]);
    expect(states[0]!.type).toBe('INITIAL');
    expect(transitions).toContainEqual({
      id: 's1-approve',
      fromStateId: 's1',
      toStateId: 's2',
      action: 'approve',
    });
    expect(transitions).toContainEqual({
      id: 's2-approve',
      fromStateId: 's2',
      toStateId: APPROVED_STATE_ID,
      action: 'approve',
    });
    expect(transitions.filter((t) => t.action === 'reject')).toHaveLength(2);

    const back = engineToSteps({
      id: 'd',
      tenantId: 't',
      name: 'n',
      entityType: 'student',
      description: null,
      states,
      transitions,
      escalationRules: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(back).toEqual(steps);
  });
});

describe('G-924 /workflows and /workflow-engine share one store', () => {
  let app: FastifyInstance;

  const headers = (roleId: string, tenantId = WORKFLOW_DEMO_TENANT_ID) => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: `${roleId}-1`,
      tenantId,
      email: `${roleId}@example.com`,
      displayName: roleId,
      roles: [{ roleId, roleName: roleId, areaId: 'root' }],
      areas: [],
      institutions: [],
      jti: `jti-${roleId}-${tenantId}`,
      sessionId: `session-${roleId}-${tenantId}`,
    } as never)}`,
    'x-tenant-id': tenantId,
  });

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('seeded demo definition is visible through both surfaces', async () => {
    const ui = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/definitions/${WORKFLOW_DEF_TRANSFER_ID}`,
      headers: headers('admin'),
    });
    expect(ui.statusCode, ui.body).toBe(200);
    expect(ui.json().steps.map((s: { approverRole: string }) => s.approverRole)).toEqual([
      'PRINCIPAL',
      'DISTRICT_ADMIN',
    ]);

    const engine = await app.inject({
      method: 'GET',
      url: `/api/v1/workflow-engine/${WORKFLOW_DEF_TRANSFER_ID}`,
      headers: headers('admin'),
    });
    expect(engine.statusCode, engine.body).toBe(200);
    expect(engine.json().states.map((s: { id: string }) => s.id)).toContain(APPROVED_STATE_ID);
  });

  it('UI-created definition is an engine definition; UI approval is an engine transition with audit', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/definitions',
      headers: headers('admin'),
      payload: {
        name: 'Fee waiver approval',
        module: 'fees',
        steps: [
          { name: 'Accounts review', approverRole: 'ACCOUNTANT' },
          { name: 'Principal sign-off', approverRole: 'PRINCIPAL' },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const definitionId = created.json().id as string;

    const engineDef = await app.inject({
      method: 'GET',
      url: `/api/v1/workflow-engine/${definitionId}`,
      headers: headers('admin'),
    });
    expect(engineDef.statusCode, engineDef.body).toBe(200);
    expect(engineDef.json().entityType).toBe('fees');

    const instance = await app.inject({
      method: 'POST',
      url: '/api/v1/workflow-engine/instances',
      headers: headers('admin'),
      payload: {
        workflowDefinitionId: definitionId,
        entityType: 'fees',
        entityId: 'inv-42',
        metadata: { initiatedBy: 'accounts@school.org' },
      },
    });
    expect(instance.statusCode, instance.body).toBe(201);
    const instanceId = instance.json().id as string;

    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/approvals/pending',
      headers: headers('admin'),
    });
    expect(pending.statusCode).toBe(200);
    const approval = pending
      .json()
      .data.find((a: { instanceId: string }) => a.instanceId === instanceId);
    expect(approval).toBeDefined();
    expect(approval.stepName).toBe('Accounts review');
    expect(approval.subjectId).toBe('inv-42');

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/approvals/${approval.id}/approve`,
      headers: headers('admin'),
    });
    expect(approved.statusCode, approved.body).toBe(200);

    const engineInstance = await app.inject({
      method: 'GET',
      url: `/api/v1/workflow-engine/instances/${instanceId}`,
      headers: headers('admin'),
    });
    expect(engineInstance.statusCode).toBe(200);
    expect(engineInstance.json().currentStateId).not.toBe(APPROVED_STATE_ID);
    expect(engineInstance.json().status).toBe('ACTIVE');

    const audit = await app.inject({
      method: 'GET',
      url: `/api/v1/workflow-engine/instances/${instanceId}/audit`,
      headers: headers('admin'),
    });
    expect(audit.statusCode, audit.body).toBe(200);
    const rows = (audit.json().data ?? audit.json()) as Array<{ action: string; actorId: string }>;
    expect(rows.some((r) => r.action === 'approve' && r.actorId === 'admin-1')).toBe(true);

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/approvals/${instanceId}/reject`,
      headers: headers('admin'),
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    const done = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/instances',
      headers: headers('admin'),
    });
    const row = done.json().data.find((i: { id: string }) => i.id === instanceId);
    expect(row.status).toBe('REJECTED');

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/approvals/${instanceId}/approve`,
      headers: headers('admin'),
    });
    expect(again.statusCode).toBe(404);
  });

  it('seeded pending instance is decidable through the UI and disappears from pending', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/approvals/pending',
      headers: headers('admin'),
    });
    expect(
      before
        .json()
        .data.some((a: { instanceId: string }) => a.instanceId === WORKFLOW_INSTANCE_PENDING_ID),
    ).toBe(true);
    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/approvals/${WORKFLOW_INSTANCE_PENDING_ID}/approve`,
      headers: headers('admin'),
    });
    expect(approve.statusCode, approve.body).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/approvals/pending',
      headers: headers('admin'),
    });
    expect(
      after
        .json()
        .data.some((a: { instanceId: string }) => a.instanceId === WORKFLOW_INSTANCE_PENDING_ID),
    ).toBe(false);
  });

  it('another tenant sees none of it', async () => {
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/definitions',
      headers: headers('admin', '660e8400-e29b-41d4-a716-446655440001'),
    });
    expect(other.statusCode).toBe(200);
    expect(other.json().data).toEqual([]);
  });
});
