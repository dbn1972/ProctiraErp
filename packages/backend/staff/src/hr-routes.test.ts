/**
 * G-918 staff HR routes — tenant required, JWT actor on attendance.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerStaffHrRoutes } from './hr-routes.js';
import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { StaffService } from './staff-service.js';

const TENANT_ID = randomUUID();

describe('Staff HR routes (G-918)', () => {
  let app: FastifyInstance;
  let staffService: StaffService;

  beforeEach(async () => {
    app = Fastify();
    const repo = new InMemoryStaffRepository();
    staffService = new StaffService(repo);
    const hrService = new StaffHrService(new InMemoryStaffHrStore(), staffService);
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
      (request as FastifyRequest & { user?: { sub?: string; roles?: string[] } }).user = {
        sub: 'jwt-hr',
        roles: ['hr_officer'],
      };
    });
    await registerStaffHrRoutes(app, { hrService });
    await app.ready();
  });

  async function createStaff() {
    return staffService.create(TENANT_ID, {
      firstName: 'Alan',
      lastName: 'Turing',
      dateOfBirth: '1912-06-23',
      identityNumber: `ID-${randomUUID().slice(0, 8)}`,
      contactPhone: '+1555',
      position: 'Teacher',
    });
  }

  it('creates a contract and lists it', async () => {
    const staff = await createStaff();
    const created = await app.inject({
      method: 'POST',
      url: '/staff/contracts',
      payload: {
        staffId: staff.id,
        contractType: 'probation',
        startDate: '2026-09-01',
        endDate: '2026-12-01',
        salaryBand: 'L2',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().renewalAlert).toBeTypeOf('boolean');

    const list = await app.inject({ method: 'GET', url: '/staff/contracts' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
  });

  it('marks attendance using JWT sub, ignoring x-user-id', async () => {
    const staff = await createStaff();
    const marked = await app.inject({
      method: 'POST',
      url: '/staff/attendance',
      headers: { 'x-user-id': 'forged' },
      payload: { staffId: staff.id, date: '2026-09-09', status: 'present' },
    });
    expect(marked.statusCode).toBe(201);
    expect(marked.json().markedBy).toBe('jwt-hr');
  });

  it('returns 400 without tenant', async () => {
    const noTenant = Fastify();
    const repo = new InMemoryStaffRepository();
    const hrService = new StaffHrService(new InMemoryStaffHrStore(), new StaffService(repo));
    await registerStaffHrRoutes(noTenant, { hrService });
    await noTenant.ready();
    const response = await noTenant.inject({ method: 'GET', url: '/staff/contracts' });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('TENANT_REQUIRED');
  });

  it('dry-runs a CSV import', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/staff/import/dry-run',
      payload: {
        csv: 'firstName,lastName,dateOfBirth,identityNumber,contactPhone,position\nA,B,1990-01-01,X1,+1,Teacher',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().valid).toBe(1);
  });
});
