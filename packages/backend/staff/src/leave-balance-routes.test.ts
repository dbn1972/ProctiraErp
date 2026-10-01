/**
 * PRC-H091 — leave balances are settable/readable over HTTP, and approving a
 * leave without a configured balance fails with a clear 422.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { registerStaffLeaveRoutes } from './leave-routes.js';
import { StaffLeaveService } from './leave-service.js';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_TENANT_STAFF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

async function buildApp(roles: string[]): Promise<FastifyInstance> {
  const app = Fastify();
  const leaveService = new StaffLeaveService(new InMemoryStaffLeaveRepository());
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
    (request as FastifyRequest & { user?: { sub?: string; roles?: string[] } }).user = {
      sub: 'hr-actor',
      roles,
    };
  });
  await registerStaffLeaveRoutes(app, {
    leaveService,
    staffExists: async (tenantId, staffId) => tenantId === TENANT_ID && staffId === STAFF_ID,
  });
  await app.ready();
  return app;
}

async function requestLeave(app: FastifyInstance): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/staff/leaves',
    payload: {
      staffId: STAFF_ID,
      leaveType: 'annual',
      startDate: '2026-09-10',
      endDate: '2026-09-12',
    },
  });
  expect(created.statusCode).toBe(201);
  return created.json().id as string;
}

describe('PRC-H091 staff leave balance routes', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp(['hr_officer']);
  });

  it('set balance then approve leave succeeds and decrements the balance', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/staff/${STAFF_ID}/leave-balances`,
      payload: { leaveType: 'annual', balanceDays: 10 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ staffId: STAFF_ID, leaveType: 'annual', balanceDays: 10 });

    const leaveId = await requestLeave(app);
    const decided = await app.inject({
      method: 'POST',
      url: `/staff/leaves/${leaveId}/decide`,
      payload: { status: 'approved' },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().status).toBe('approved');

    const get = await app.inject({ method: 'GET', url: `/staff/${STAFF_ID}/leave-balances` });
    expect(get.statusCode).toBe(200);
    expect(get.json().data).toEqual([
      expect.objectContaining({ leaveType: 'annual', balanceDays: 7 }),
    ]);
  });

  it('no balance configured -> approve returns a clear 422', async () => {
    const leaveId = await requestLeave(app);
    const decided = await app.inject({
      method: 'POST',
      url: `/staff/leaves/${leaveId}/decide`,
      payload: { status: 'approved' },
    });
    expect(decided.statusCode).toBe(422);
    expect(decided.json().message).toMatch(/No annual leave balance is configured/);
  });

  it('unknown / other-tenant staff -> 404', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/staff/${OTHER_TENANT_STAFF}/leave-balances`,
      payload: { leaveType: 'annual', balanceDays: 5 },
    });
    expect(res.statusCode).toBe(404);
    const get = await app.inject({
      method: 'GET',
      url: `/staff/${OTHER_TENANT_STAFF}/leave-balances`,
    });
    expect(get.statusCode).toBe(404);
  });

  it('rejects negative / unpaid balances with 400', async () => {
    const neg = await app.inject({
      method: 'PUT',
      url: `/staff/${STAFF_ID}/leave-balances`,
      payload: { leaveType: 'annual', balanceDays: -1 },
    });
    expect(neg.statusCode).toBe(400);
    const unpaid = await app.inject({
      method: 'PUT',
      url: `/staff/${STAFF_ID}/leave-balances`,
      payload: { leaveType: 'unpaid', balanceDays: 3 },
    });
    expect(unpaid.statusCode).toBe(400);
  });

  it('non-HR roles cannot read or write balances', async () => {
    const teacher = await buildApp(['teacher']);
    const get = await teacher.inject({ method: 'GET', url: `/staff/${STAFF_ID}/leave-balances` });
    expect(get.statusCode).toBe(403);
    const put = await teacher.inject({
      method: 'PUT',
      url: `/staff/${STAFF_ID}/leave-balances`,
      payload: { leaveType: 'annual', balanceDays: 99 },
    });
    expect(put.statusCode).toBe(403);
  });
});
