/**
 * PRC-H091 — bulk opening-balance import: all-or-nothing, tenant-scoped staff check,
 * dry-run, HR-only, then the imported balance is consumed by a leave approval.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { registerStaffLeaveRoutes } from './leave-routes.js';
import { StaffLeaveService } from './leave-service.js';
import { StaffService } from './staff-service.js';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STAFF_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OTHER_TENANT_STAFF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const URL = '/staff/leave-balances/import';

async function buildApp(roles: string[]) {
  const app = Fastify();
  const repo = new InMemoryStaffLeaveRepository();
  const leaveService = new StaffLeaveService(repo);
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
    staffService: new StaffService(new InMemoryStaffRepository()),
    staffExists: async (tenantId, staffId) =>
      tenantId === TENANT_ID && (staffId === STAFF_A || staffId === STAFF_B),
  });
  await app.ready();
  return { app, repo };
}

describe('PRC-H091 POST /staff/leave-balances/import', () => {
  let app: FastifyInstance;
  let repo: InMemoryStaffLeaveRepository;
  beforeEach(async () => {
    ({ app, repo } = await buildApp(['hr_officer']));
  });

  it('imports many balances; an approval then consumes the imported balance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      payload: {
        rows: [
          { staffId: STAFF_A, leaveType: 'annual', balanceDays: 12 },
          { staffId: STAFF_A, leaveType: 'sick', balanceDays: 6.5 },
          { staffId: STAFF_B, leaveType: 'annual', balanceDays: 10 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dryRun: false, rows: 3, imported: 3 });
    expect((await repo.getBalance(TENANT_ID, STAFF_B, 'annual'))?.balanceDays).toBe(10);

    const leave = await app.inject({
      method: 'POST',
      url: '/staff/leaves',
      payload: {
        staffId: STAFF_A,
        leaveType: 'annual',
        startDate: '2026-09-10',
        endDate: '2026-09-11',
      },
    });
    expect(leave.statusCode).toBe(201);
    const decided = await app.inject({
      method: 'POST',
      url: `/staff/leaves/${leave.json().id as string}/decide`,
      payload: { status: 'approved' },
    });
    expect(decided.statusCode).toBe(200);
    expect((await repo.getBalance(TENANT_ID, STAFF_A, 'annual'))?.balanceDays).toBe(10);
  });

  it('dryRun validates without writing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      payload: { dryRun: true, rows: [{ staffId: STAFF_A, leaveType: 'annual', balanceDays: 5 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dryRun: true, imported: 0 });
    expect(await repo.getBalance(TENANT_ID, STAFF_A, 'annual')).toBeNull();
  });

  it('one other-tenant staff id rejects the whole batch (nothing written)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      payload: {
        rows: [
          { staffId: STAFF_A, leaveType: 'annual', balanceDays: 5 },
          { staffId: OTHER_TENANT_STAFF, leaveType: 'annual', balanceDays: 5 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain('rows[1].staffId');
    expect(await repo.getBalance(TENANT_ID, STAFF_A, 'annual')).toBeNull();
  });

  it('duplicate staffId+leaveType rejects the batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      payload: {
        rows: [
          { staffId: STAFF_A, leaveType: 'annual', balanceDays: 5 },
          { staffId: STAFF_A, leaveType: 'annual', balanceDays: 8 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(await repo.getBalance(TENANT_ID, STAFF_A, 'annual')).toBeNull();
  });

  it('schema: empty rows, negative days, unknown fields -> 400', async () => {
    for (const payload of [
      { rows: [] },
      { rows: [{ staffId: STAFF_A, leaveType: 'annual', balanceDays: -1 }] },
      { rows: [{ staffId: STAFF_A, leaveType: 'unpaid', balanceDays: 1 }] },
      { rows: [{ staffId: 'not-a-uuid', leaveType: 'annual', balanceDays: 1 }] },
      { rows: [{ staffId: STAFF_A, leaveType: 'annual', balanceDays: 1, tenantId: 'x' }] },
    ]) {
      const res = await app.inject({ method: 'POST', url: URL, payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('non-HR roles get 403', async () => {
    const { app: teacher } = await buildApp(['teacher']);
    const res = await teacher.inject({
      method: 'POST',
      url: URL,
      payload: { rows: [{ staffId: STAFF_A, leaveType: 'annual', balanceDays: 99 }] },
    });
    expect(res.statusCode).toBe(403);
  });
});
