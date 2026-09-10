/**
 * Staff leave routes — JWT-only actor (G-102 / G-206).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { registerStaffLeaveRoutes } from './leave-routes.js';
import { StaffLeaveService } from './leave-service.js';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('Staff leave routes JWT actor', () => {
  let app: FastifyInstance;
  let repo: InMemoryStaffLeaveRepository;

  beforeEach(async () => {
    app = Fastify();
    repo = new InMemoryStaffLeaveRepository();
    await repo.setBalance(TENANT_ID, STAFF_ID, 'annual', 10);
    const leaveService = new StaffLeaveService(repo);

    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
      (request as FastifyRequest & { user?: { sub?: string } }).user = { sub: 'jwt-actor-sub' };
    });

    await registerStaffLeaveRoutes(app, { leaveService });
    await app.ready();
  });

  it('uses request.user.sub and ignores forged x-user-id header', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/staff/leaves',
      payload: {
        staffId: STAFF_ID,
        leaveType: 'annual',
        startDate: '2026-09-10',
        endDate: '2026-09-10',
      },
    });
    expect(created.statusCode).toBe(201);
    const leaveId = created.json().id as string;

    const decided = await app.inject({
      method: 'POST',
      url: `/staff/leaves/${leaveId}/decide`,
      headers: { 'x-user-id': 'forged-header-actor' },
      payload: { status: 'approved' },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().decidedBy).toBe('jwt-actor-sub');
    expect(decided.json().decidedBy).not.toBe('forged-header-actor');
  });
});
