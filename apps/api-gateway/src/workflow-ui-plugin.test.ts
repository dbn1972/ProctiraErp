/**
 * Unit tests for Workflow UI aggregate routes (tenant + RBAC + mutations).
 */
import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { workflowUiPlugin } from './workflow-ui-plugin.js';
import {
  WORKFLOW_APPROVAL_PENDING_ID,
  WORKFLOW_DEF_TRANSFER_ID,
  WORKFLOW_DEMO_TENANT_ID,
} from './workflow-ui-seed.js';

// Alias kept for readability in assertions below.
const PENDING_APPROVAL_ID = WORKFLOW_APPROVAL_PENDING_ID;

type TestUser = {
  sub: string;
  tenantId?: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string }>;
};

function setUser(request: FastifyRequest, user: TestUser, tenantId?: string) {
  const req = request as FastifyRequest & { user?: TestUser; tenantId?: string };
  req.user = user as FastifyRequest['user'] & TestUser;
  if (tenantId) req.tenantId = tenantId;
}

describe('workflowUiPlugin', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    while (apps.length) {
      const app = apps.pop();
      if (app) await app.close();
    }
  });

  async function buildApp() {
    const app = Fastify();
    apps.push(app);
    await app.register(workflowUiPlugin);
    await app.ready();
    return app;
  }

  it('returns 403 when caller lacks a workflow role', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/workflows/definitions',
      headers: { 'x-tenant-id': WORKFLOW_DEMO_TENANT_ID },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when workflow role is present but tenant is missing', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(request, {
        sub: 'u1',
        roles: [{ roleId: 'principal', roleName: 'PRINCIPAL', areaId: 'area-1' }],
      });
    });
    await app.register(workflowUiPlugin);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/workflows/definitions' });
    expect(res.statusCode).toBe(400);
  });

  it('returns seeded definitions for matching tenant + role', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(
        request,
        {
          sub: 'u1',
          tenantId: WORKFLOW_DEMO_TENANT_ID,
          roles: [{ roleId: 'admin', roleName: 'TENANT_ADMIN', areaId: 'area-1' }],
        },
        WORKFLOW_DEMO_TENANT_ID,
      );
    });
    await app.register(workflowUiPlugin);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/workflows/definitions',
      headers: { 'x-tenant-id': WORKFLOW_DEMO_TENANT_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((d) => d.id === WORKFLOW_DEF_TRANSFER_ID)).toBe(true);
  });

  it('returns empty list for a different tenant (cross-tenant deny)', async () => {
    const otherTenant = '11111111-1111-4111-8111-111111111111';
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(
        request,
        {
          sub: 'u1',
          tenantId: otherTenant,
          roles: [{ roleId: 'admin', roleName: 'TENANT_ADMIN', areaId: 'area-1' }],
        },
        otherTenant,
      );
    });
    await app.register(workflowUiPlugin);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/workflows/definitions',
      headers: { 'x-tenant-id': otherTenant },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
  });

  it('creates a definition and lists pending approvals for authorize tenant', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(
        request,
        {
          sub: 'u1',
          tenantId: WORKFLOW_DEMO_TENANT_ID,
          roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: 'area-1' }],
        },
        WORKFLOW_DEMO_TENANT_ID,
      );
    });
    await app.register(workflowUiPlugin);
    await app.ready();

    const create = await app.inject({
      method: 'POST',
      url: '/workflows/definitions',
      headers: {
        'x-tenant-id': WORKFLOW_DEMO_TENANT_ID,
        'content-type': 'application/json',
      },
      payload: {
        name: 'Exam paper release',
        module: 'examination',
        steps: [{ name: 'Controller review', approverRole: 'EXAM_CONTROLLER' }],
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string; name: string };
    expect(created.name).toBe('Exam paper release');
    expect(created.id).toBeTruthy();

    const pending = await app.inject({
      method: 'GET',
      url: '/workflows/approvals/pending',
    });
    expect(pending.statusCode).toBe(200);
    const body = pending.json() as { data: Array<{ id: string }> };
    expect(body.data.some((a) => a.id === PENDING_APPROVAL_ID)).toBe(true);
  });

  it('approves a pending approval and clears it from the queue', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(
        request,
        {
          sub: 'u1',
          tenantId: WORKFLOW_DEMO_TENANT_ID,
          roles: [{ roleId: 'district', roleName: 'DISTRICT_ADMIN', areaId: 'area-1' }],
        },
        WORKFLOW_DEMO_TENANT_ID,
      );
    });
    await app.register(workflowUiPlugin);
    await app.ready();

    const approve = await app.inject({
      method: 'POST',
      url: `/workflows/approvals/${PENDING_APPROVAL_ID}/approve`,
    });
    expect(approve.statusCode).toBe(200);

    const pending = await app.inject({
      method: 'GET',
      url: '/workflows/approvals/pending',
    });
    const body = pending.json() as { data: Array<{ id: string }> };
    expect(body.data.some((a) => a.id === PENDING_APPROVAL_ID)).toBe(false);
  });
});
