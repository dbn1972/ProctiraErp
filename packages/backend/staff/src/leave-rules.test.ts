/**
 * PRC-M373: staff leave rules over HTTP (in-memory repository).
 *
 * - overlap: a second pending/approved leave sharing a day with another is 409
 * - separation of duties: the staff member the leave is for cannot decide it
 * - date validation: impossible or malformed dates are 400
 * - cancel: pending or approved leave can be cancelled; an approved
 *   balance-tracked leave gets its debited days back
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { registerStaffLeaveRoutes } from './leave-routes.js';
import { StaffLeaveService } from './leave-service.js';
import { StaffService } from './staff-service.js';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_STAFF_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ACTOR = 'hr-officer-sub';

describe('PRC-M373 staff leave rules', () => {
  let app: FastifyInstance;
  let repo: InMemoryStaffLeaveRepository;

  beforeEach(async () => {
    app = Fastify();
    repo = new InMemoryStaffLeaveRepository();
    await repo.setBalance(TENANT_ID, STAFF_ID, 'annual', 10);
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
      (request as FastifyRequest & { user?: { sub?: string; roles?: string[] } }).user = {
        sub: ACTOR,
        roles: ['hr_officer'],
      };
    });
    await registerStaffLeaveRoutes(app, {
      leaveService: new StaffLeaveService(repo),
      staffService: new StaffService(new InMemoryStaffRepository()),
    });
    await app.ready();
  });

  const create = (body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/staff/leaves',
      payload: { staffId: STAFF_ID, leaveType: 'annual', ...body },
    });
  const decide = (id: string, status: 'approved' | 'rejected') =>
    app.inject({ method: 'POST', url: `/staff/leaves/${id}/decide`, payload: { status } });
  const cancel = (id: string) => app.inject({ method: 'POST', url: `/staff/leaves/${id}/cancel` });

  it('rejects an overlapping pending/approved leave for the same staff member (409)', async () => {
    const first = await create({ startDate: '2026-09-10', endDate: '2026-09-12' });
    expect(first.statusCode).toBe(201);
    // Inclusive ranges: sharing only the 12th is an overlap.
    const overlap = await create({ startDate: '2026-09-12', endDate: '2026-09-14' });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().message).toMatch(/overlapping/);
    // Another staff member, or adjacent days, are fine.
    expect(
      (await create({ staffId: OTHER_STAFF_ID, startDate: '2026-09-10', endDate: '2026-09-12' }))
        .statusCode,
    ).toBe(201);
    expect((await create({ startDate: '2026-09-13', endDate: '2026-09-13' })).statusCode).toBe(201);
    // Once approved it still blocks; once rejected it no longer does.
    expect((await decide(first.json().id, 'approved')).statusCode).toBe(200);
    expect((await create({ startDate: '2026-09-11', endDate: '2026-09-11' })).statusCode).toBe(409);
    const second = await create({ startDate: '2026-09-20', endDate: '2026-09-20' });
    expect((await decide(second.json().id, 'rejected')).statusCode).toBe(200);
    expect((await create({ startDate: '2026-09-20', endDate: '2026-09-20' })).statusCode).toBe(201);
  });

  it('refuses a decision by the staff member the leave is for (409)', async () => {
    repo.linkPrincipalToStaff(ACTOR, STAFF_ID);
    const own = await create({ startDate: '2026-09-10', endDate: '2026-09-10' });
    const res = await decide(own.json().id, 'approved');
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/cannot be decided by the staff member/);
    const after = await repo.findLeaveById(own.json().id, TENANT_ID);
    expect(after?.status).toBe('pending');
    expect((await repo.getBalance(TENANT_ID, STAFF_ID, 'annual'))?.balanceDays).toBe(10);
    // A different staff member's leave is decided normally by the same actor.
    const other = await create({
      staffId: OTHER_STAFF_ID,
      leaveType: 'unpaid',
      startDate: '2026-09-10',
      endDate: '2026-09-10',
    });
    expect((await decide(other.json().id, 'approved')).statusCode).toBe(200);
  });

  it.each([
    ['2026-02-30', '2026-03-01'],
    ['2026-13-01', '2026-13-02'],
    ['2026-9-1', '2026-09-02'],
    ['2026-09-01T00:00', '2026-09-02'],
    ['2026-09-01', '20260902'],
  ])('rejects malformed or impossible dates %s..%s (400)', async (startDate, endDate) => {
    const res = await create({ startDate, endDate });
    expect(res.statusCode).toBe(400);
  });

  it('cancels a pending leave without touching the balance', async () => {
    const leave = await create({ startDate: '2026-09-10', endDate: '2026-09-12' });
    const res = await cancel(leave.json().id);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    expect((await repo.getBalance(TENANT_ID, STAFF_ID, 'annual'))?.balanceDays).toBe(10);
    // A cancelled leave no longer blocks the same days.
    expect((await create({ startDate: '2026-09-10', endDate: '2026-09-12' })).statusCode).toBe(201);
  });

  it('cancels an approved leave and restores the debited days', async () => {
    const leave = await create({ startDate: '2026-09-10', endDate: '2026-09-12' });
    expect((await decide(leave.json().id, 'approved')).statusCode).toBe(200);
    expect((await repo.getBalance(TENANT_ID, STAFF_ID, 'annual'))?.balanceDays).toBe(7);
    const res = await cancel(leave.json().id);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
    expect((await repo.getBalance(TENANT_ID, STAFF_ID, 'annual'))?.balanceDays).toBe(10);
    // Cancelling twice is a conflict and does not credit again.
    expect((await cancel(leave.json().id)).statusCode).toBe(409);
    expect((await repo.getBalance(TENANT_ID, STAFF_ID, 'annual'))?.balanceDays).toBe(10);
  });

  it('refuses to cancel a rejected leave (409) and an unknown one (404)', async () => {
    const leave = await create({ startDate: '2026-09-10', endDate: '2026-09-10' });
    expect((await decide(leave.json().id, 'rejected')).statusCode).toBe(200);
    expect((await cancel(leave.json().id)).statusCode).toBe(409);
    expect((await cancel('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).statusCode).toBe(404);
  });
});
