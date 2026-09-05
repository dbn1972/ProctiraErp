/**
 * Unit tests for Health UI aggregate routes (tenant + RBAC gates).
 */
import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { healthUiPlugin } from './health-ui-plugin.js';
import { HEALTH_DEMO_TENANT_ID, HEALTH_STUDENT_A_ID } from './health-ui-seed.js';

type TestUser = {
  sub: string;
  tenantId?: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string }>;
};

function setUser(request: FastifyRequest, user: TestUser, tenantId?: string) {
  const req = request as FastifyRequest & { user?: TestUser; tenantId?: string };
  // Test doubles intentionally omit full JwtPayload fields.
  req.user = user as FastifyRequest['user'] & TestUser;
  if (tenantId) req.tenantId = tenantId;
}

describe('healthUiPlugin', () => {
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
    await app.register(healthUiPlugin);
    await app.ready();
    return app;
  }

  it('returns 403 when caller lacks a health role', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/health/records',
      headers: { 'x-tenant-id': HEALTH_DEMO_TENANT_ID },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when health role is present but tenant is missing', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(request, {
        sub: 'u1',
        roles: [{ roleId: 'health-officer', roleName: 'HEALTH_OFFICER', areaId: 'area-1' }],
      });
    });
    await app.register(healthUiPlugin);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health/records' });
    expect(res.statusCode).toBe(400);
  });

  it('returns seeded records for matching tenant + health role', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(
        request,
        {
          sub: 'u1',
          tenantId: HEALTH_DEMO_TENANT_ID,
          roles: [{ roleId: 'health-officer', roleName: 'HEALTH_OFFICER', areaId: 'area-1' }],
        },
        HEALTH_DEMO_TENANT_ID,
      );
    });
    await app.register(healthUiPlugin);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/health/records',
      headers: { 'x-tenant-id': HEALTH_DEMO_TENANT_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ studentId: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((r) => r.studentId === HEALTH_STUDENT_A_ID)).toBe(true);
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
          roles: [{ roleId: 'health-officer', roleName: 'HEALTH_OFFICER', areaId: 'area-1' }],
        },
        otherTenant,
      );
    });
    await app.register(healthUiPlugin);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/health/records',
      headers: { 'x-tenant-id': otherTenant },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
  });

  it('returns screenings for authorized tenant', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(
        request,
        {
          sub: 'u1',
          roles: [{ roleId: 'nurse', roleName: 'NURSE', areaId: 'area-1' }],
        },
        HEALTH_DEMO_TENANT_ID,
      );
    });
    await app.register(healthUiPlugin);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health/screenings' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(body.data.length).toBeGreaterThan(0);
  });
});
