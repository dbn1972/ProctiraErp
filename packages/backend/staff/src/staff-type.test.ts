/**
 * PRC-M120 — GET /staff?type= filters (teaching / non-teaching / on leave).
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { registerStaffRoutes } from './routes.js';
import { StaffService } from './staff-service.js';
import { isTeachingPosition, staffIdsOnLeave } from './staff-type.js';

const TENANT_ID = randomUUID();
const today = new Date().toISOString().slice(0, 10);
const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('isTeachingPosition', () => {
  it('classifies teacher roles and cadres as teaching, others as non-teaching', () => {
    for (const p of ['Teacher', 'PGT', 'tgt', 'Assistant Teacher', 'Lecturer']) {
      expect(isTeachingPosition(p)).toBe(true);
    }
    for (const p of ['Principal', 'Clerk', 'Counselor', 'Support Staff', '', undefined]) {
      expect(isTeachingPosition(p)).toBe(false);
    }
  });
});

describe('GET /staff?type=', () => {
  let app: FastifyInstance;
  let names: Record<string, string>;

  beforeEach(async () => {
    const repository = new InMemoryStaffRepository();
    const leaves = new InMemoryStaffLeaveRepository();
    const service = new StaffService(repository);
    const mk = async (firstName: string, position: string) =>
      (
        await service.create(TENANT_ID, {
          firstName,
          lastName: 'Test',
          dateOfBirth: '1985-06-15',
          identityNumber: `ID-${randomUUID()}`,
          contactPhone: '+911234567890',
          position,
        })
      ).id;
    const teacher = await mk('Tara', 'Teacher');
    const clerk = await mk('Chandu', 'Clerk');
    const pgt = await mk('Priya', 'PGT');
    names = { [teacher]: 'Tara', [clerk]: 'Chandu', [pgt]: 'Priya' };
    const leave = (staffId: string, status: 'approved' | 'pending', from: string, to: string) =>
      leaves.createLeave({
        id: randomUUID(),
        tenantId: TENANT_ID,
        staffId,
        leaveType: 'casual',
        startDate: from,
        endDate: to,
        reason: null,
        status,
        decidedBy: null,
        decidedAt: null,
      });
    await leave(teacher, 'approved', dayOffset(-1), dayOffset(1)); // on leave today
    await leave(clerk, 'pending', today, today); // pending ≠ on leave
    await leave(pgt, 'approved', dayOffset(-5), dayOffset(-2)); // ended

    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { roles: string[] } }).user = { roles: ['hr_officer'] };
    });
    await registerStaffRoutes(app, {
      staffService: service,
      onLeaveStaffIds: async (tenantId, d) =>
        staffIdsOnLeave(await leaves.listLeaves(tenantId), d),
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const listNames = async (type: string) => {
    const res = await app.inject({ method: 'GET', url: `/staff?type=${type}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { firstName: string }[]; meta: { totalItems: number } };
    expect(body.meta.totalItems).toBe(body.data.length);
    return body.data.map((s) => s.firstName).sort();
  };

  it('ON_LEAVE returns only staff with an approved leave covering today', async () => {
    expect(await listNames('ON_LEAVE')).toEqual(['Tara']);
    expect(Object.values(names)).toHaveLength(3);
  });

  it('TEACHING / NON_TEACHING split by position; ALL returns everyone', async () => {
    expect(await listNames('TEACHING')).toEqual(['Priya', 'Tara']);
    expect(await listNames('NON_TEACHING')).toEqual(['Chandu']);
    expect(await listNames('ALL')).toEqual(['Chandu', 'Priya', 'Tara']);
  });

  it('rejects an unknown type with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/staff?type=BOGUS' });
    expect(res.statusCode).toBe(400);
  });

  it('fails closed (501) for ON_LEAVE when no leave source is wired', async () => {
    const bare = Fastify();
    bare.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { roles: string[] } }).user = { roles: ['hr_officer'] };
    });
    await registerStaffRoutes(bare, {
      staffService: new StaffService(new InMemoryStaffRepository()),
    });
    const res = await bare.inject({ method: 'GET', url: '/staff?type=ON_LEAVE' });
    expect(res.statusCode).toBe(501);
    await bare.close();
  });
});
