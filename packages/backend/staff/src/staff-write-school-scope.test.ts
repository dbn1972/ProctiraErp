/**
 * PRC-H090 — the staff mutation routes must enforce school scope using the caller's
 * institution list from the JWT. Before the fix, assertStaffWritableInInstitutions was never
 * called from any handler, so a school-A-bound HR officer could update/delete/offboard a
 * school-B staff member by UUID. These tests fail (200/204) without the wired guard.
 */
import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerStaffHrRoutes } from './hr-routes.js';
import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { registerStaffLeaveRoutes } from './leave-routes.js';
import { StaffLeaveService } from './leave-service.js';
import { registerStaffRoutes } from './routes.js';
import type { StaffEntity } from './staff-repository.js';
import { StaffService } from './staff-service.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const STAFF_A = '11111111-1111-4111-8111-111111111111';
const STAFF_B = '22222222-2222-4222-8222-222222222222';

function baseStaff(id: string): Omit<StaffEntity, 'createdAt' | 'updatedAt'> {
  return {
    id,
    tenantId: TENANT,
    firstName: `F${id.slice(0, 4)}`,
    lastName: `L${id.slice(0, 4)}`,
    identityNumber: `ID-${id.slice(0, 4)}`,
    position: 'teacher',
    status: 'ACTIVE',
    dateOfBirth: '1990-01-01',
    contactPhone: '0000000000',
    contactEmail: null,
    customData: {},
  };
}

async function seed() {
  const repo = new InMemoryStaffRepository();
  const aId = (await repo.create(baseStaff(STAFF_A))).id;
  const bId = (await repo.create(baseStaff(STAFF_B))).id;
  repo.addAssignment(TENANT, SCHOOL_A, aId);
  repo.addAssignment(TENANT, SCHOOL_B, bId);
  return { repo, aId, bId };
}

/** School-A-bound HR officer (has an institutions list, not a board/tenant admin role). */
const SCHOOL_A_USER = { roles: ['hr_officer'], institutions: [SCHOOL_A] };

async function mountStaff(repo: InMemoryStaffRepository, user: unknown): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as { tenantId: string; user?: unknown }).tenantId = TENANT;
    (request as { user?: unknown }).user = user;
  });
  await registerStaffRoutes(app, { staffService: new StaffService(repo) });
  await app.ready();
  return app;
}

describe('PRC-H090 staff core mutation routes enforce school scope', () => {
  it('school-A HR officer cannot UPDATE a school-B staff member (404)', async () => {
    const { repo, bId } = await seed();
    const app = await mountStaff(repo, SCHOOL_A_USER);
    const res = await app.inject({
      method: 'PUT',
      url: `/staff/${bId}`,
      payload: { firstName: 'Hacked' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('school-A HR officer cannot DELETE a school-B staff member (404)', async () => {
    const { repo, bId } = await seed();
    const app = await mountStaff(repo, SCHOOL_A_USER);
    const res = await app.inject({ method: 'DELETE', url: `/staff/${bId}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('school-A HR officer cannot OFFBOARD a school-B staff member (404)', async () => {
    const { repo, bId } = await seed();
    const app = await mountStaff(repo, SCHOOL_A_USER);
    const res = await app.inject({
      method: 'POST',
      url: `/staff/${bId}/offboard`,
      payload: { effectiveDate: '2026-01-15' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('school-A HR officer CAN update their own school staff (not 404)', async () => {
    const { repo, aId } = await seed();
    const app = await mountStaff(repo, SCHOOL_A_USER);
    const res = await app.inject({
      method: 'PUT',
      url: `/staff/${aId}`,
      payload: { firstName: 'Ok' },
    });
    expect(res.statusCode).not.toBe(404);
    await app.close();
  });

  it('a tenant-wide admin (no institutions list) may cross schools', async () => {
    const { repo, bId } = await seed();
    const app = await mountStaff(repo, { roles: ['admin'] });
    const res = await app.inject({
      method: 'PUT',
      url: `/staff/${bId}`,
      payload: { firstName: 'Ok' },
    });
    expect(res.statusCode).not.toBe(404);
    await app.close();
  });
});

describe('PRC-H090 HR + leave mutation routes enforce school scope', () => {
  async function mountHr(repo: InMemoryStaffRepository, user: unknown): Promise<FastifyInstance> {
    const app = Fastify();
    const staffService = new StaffService(repo);
    const hrService = new StaffHrService(new InMemoryStaffHrStore(), staffService, {});
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string; user?: unknown }).tenantId = TENANT;
      (request as { user?: unknown }).user = user;
    });
    await registerStaffHrRoutes(app, { hrService, staffService });
    await app.ready();
    return app;
  }

  async function mountLeave(
    repo: InMemoryStaffRepository,
    user: unknown,
  ): Promise<FastifyInstance> {
    const app = Fastify();
    const staffService = new StaffService(repo);
    const leaveRepo = new InMemoryStaffLeaveRepository();
    const staffExists = async (t: string, s: string) => (await repo.findById(s, t)) !== null;
    const leaveService = new StaffLeaveService(leaveRepo, staffExists);
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string; user?: unknown }).tenantId = TENANT;
      (request as { user?: unknown }).user = user;
    });
    await registerStaffLeaveRoutes(app, { leaveService, staffService, staffExists });
    await app.ready();
    return app;
  }

  it('school-A HR officer cannot create a contract for a school-B staff member (404)', async () => {
    const { repo, bId } = await seed();
    const app = await mountHr(repo, SCHOOL_A_USER);
    const res = await app.inject({
      method: 'POST',
      url: '/staff/contracts',
      payload: {
        staffId: bId,
        contractType: 'permanent',
        startDate: '2026-01-01',
        salaryBand: 'A1',
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('school-A HR officer cannot create a leave for a school-B staff member (404)', async () => {
    const { repo, bId } = await seed();
    const app = await mountLeave(repo, SCHOOL_A_USER);
    const res = await app.inject({
      method: 'POST',
      url: '/staff/leaves',
      payload: {
        staffId: bId,
        leaveType: 'annual',
        startDate: '2026-02-01',
        endDate: '2026-02-02',
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('school-A HR officer is denied tenant-wide payroll export (403)', async () => {
    const { repo } = await seed();
    const app = await mountHr(repo, SCHOOL_A_USER);
    const res = await app.inject({ method: 'GET', url: '/staff/payroll/export?month=2026-01' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
