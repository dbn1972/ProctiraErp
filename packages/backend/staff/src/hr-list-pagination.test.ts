/**
 * PRC-M379: HR/leave list endpoints are paginated and reject invalid queries.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerStaffHrRoutes } from './hr-routes.js';
import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { registerStaffLeaveRoutes } from './leave-routes.js';
import { StaffLeaveService } from './leave-service.js';
import { StaffService } from './staff-service.js';

const TENANT_ID = randomUUID();

describe('HR list pagination (PRC-M379)', () => {
  let app: FastifyInstance;
  let staffService: StaffService;

  beforeEach(async () => {
    app = Fastify();
    staffService = new StaffService(new InMemoryStaffRepository());
    const hrService = new StaffHrService(new InMemoryStaffHrStore(), staffService);
    app.addHook('onRequest', async (request) => {
      Object.assign(request, { tenantId: TENANT_ID, user: { sub: 'hr', roles: ['hr_officer'] } });
    });
    await registerStaffHrRoutes(app, { hrService, staffService });
    await registerStaffLeaveRoutes(app, {
      leaveService: new StaffLeaveService(new InMemoryStaffLeaveRepository()),
      staffService,
    });
    await app.ready();
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  it('invalid attendance date -> 400 (not all rows)', async () => {
    expect((await get('/staff/attendance?from=not-a-date')).statusCode).toBe(400);
    expect((await get('/staff/contracts?staffId=nope')).statusCode).toBe(400);
    expect((await get('/staff/qualifications?unknown=1')).statusCode).toBe(400);
  });

  it('pageSize above the cap -> 400', async () => {
    for (const url of [
      '/staff/attendance?pageSize=101',
      '/staff/contracts?pageSize=1000',
      '/staff/qualifications?page=0',
      '/staff/leaves?pageSize=500',
    ]) {
      expect((await get(url)).statusCode, url).toBe(400);
    }
  });

  it('page size is honoured and total reported', async () => {
    const staff = await staffService.create(TENANT_ID, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1990-01-01',
      identityNumber: `ID-${randomUUID().slice(0, 8)}`,
      contactPhone: '+1555',
      position: 'Teacher',
    });
    for (const day of ['01', '02', '03']) {
      const res = await app.inject({
        method: 'POST',
        url: '/staff/attendance',
        payload: { staffId: staff.id, date: `2026-09-${day}`, status: 'present' },
      });
      expect(res.statusCode).toBe(201);
    }
    const res = await get(`/staff/attendance?staffId=${staff.id}&pageSize=2&page=2`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
    expect((await get('/staff/leaves')).json().meta).toMatchObject({ page: 1, totalItems: 0 });
  });
});
