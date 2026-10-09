/**
 * PRC-H088: HR routes are domain-gated on every method. GET /payroll/export persists (and with
 * ?replace=true reverses) payroll runs, so it must assert payroll.export; HR reads (contracts
 * with salary, qualifications, staff attendance) must assert staff.hr.read.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerStaffHrRoutes } from './hr-routes.js';
import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore } from './hr-store.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { staffHrActionFor } from './staff-access.js';
import { StaffService } from './staff-service.js';

const TENANT_ID = randomUUID();

describe('staffHrActionFor (PRC-H088)', () => {
  it('gates payroll on every method, including GET, with or without a version prefix', () => {
    expect(staffHrActionFor('GET', '/staff/payroll/export?month=2026-09')).toBe('payroll.export');
    expect(staffHrActionFor('GET', '/api/v1/staff/payroll/export?replace=true')).toBe(
      'payroll.export',
    );
    expect(staffHrActionFor('POST', '/api/v1/staff/payroll/export')).toBe('payroll.export');
  });

  it('maps other reads to staff.hr.read and writes to their write actions', () => {
    expect(staffHrActionFor('GET', '/api/v1/staff/contracts')).toBe('staff.hr.read');
    expect(staffHrActionFor('GET', '/staff/attendance/summary?month=2026-09')).toBe(
      'staff.hr.read',
    );
    expect(staffHrActionFor('POST', '/api/v1/staff/import/commit')).toBe('staff.import');
    expect(staffHrActionFor('POST', '/staff/contracts')).toBe('staff.hr.write');
  });
});

describe('HR route authorization (PRC-H088)', () => {
  let app: FastifyInstance;
  let roles: string[] = ['hr_officer'];

  beforeEach(async () => {
    roles = ['hr_officer'];
    app = Fastify();
    const staffService = new StaffService(new InMemoryStaffRepository());
    const hrService = new StaffHrService(new InMemoryStaffHrStore(), staffService);
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
      (request as FastifyRequest & { user?: { sub?: string; roles?: string[] } }).user = {
        sub: 'jwt-user',
        roles,
      };
    });
    await registerStaffHrRoutes(app, { hrService, staffService });
    await app.ready();
  });

  it('denies GET /staff/payroll/export to a registrar (not a payroll role)', async () => {
    roles = ['registrar'];
    const res = await app.inject({ method: 'GET', url: '/staff/payroll/export?month=2026-09' });
    expect(res.statusCode).toBe(403);
  });

  it('denies GET /staff/payroll/export?replace=true to a teacher', async () => {
    roles = ['teacher'];
    const res = await app.inject({
      method: 'GET',
      url: '/staff/payroll/export?month=2026-09&replace=true',
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows GET /staff/payroll/export for a bursar', async () => {
    roles = ['bursar'];
    const res = await app.inject({ method: 'GET', url: '/staff/payroll/export?month=2026-09' });
    expect(res.statusCode).toBe(200);
  });

  it('does not downgrade the payroll check for a percent-encoded path', async () => {
    roles = ['registrar'];
    const res = await app.inject({
      method: 'GET',
      url: '/staff/%70ayroll/export?month=2026-09',
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not downgrade the import check for a percent-encoded path', async () => {
    roles = ['admissions_officer']; // has staff.hr.write but not staff.import
    const res = await app.inject({
      method: 'POST',
      url: '/staff/%69mport/commit',
      payload: { csv: 'firstName,lastName\nA,B' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not expose a HEAD route for the side-effecting payroll export', async () => {
    roles = ['hr_officer'];
    const res = await app.inject({ method: 'HEAD', url: '/staff/payroll/export?month=2026-09' });
    expect(res.statusCode).toBe(404);
  });

  for (const url of ['/staff/contracts', '/staff/qualifications', '/staff/attendance']) {
    it(`denies ${url} reads to a teacher and to a user with no roles`, async () => {
      roles = ['teacher'];
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(403);
      roles = [];
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(403);
    });

    it(`allows ${url} reads for an HR officer`, async () => {
      roles = ['hr_officer'];
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
    });
  }
});

describe('HR route authorization under the gateway /api/v1 prefix (PRC-H088)', () => {
  let app: FastifyInstance;
  let roles: string[] = [];

  beforeEach(async () => {
    app = Fastify();
    const staffService = new StaffService(new InMemoryStaffRepository());
    const hrService = new StaffHrService(new InMemoryStaffHrStore(), staffService);
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
      (request as FastifyRequest & { user?: { sub?: string; roles?: string[] } }).user = {
        sub: 'jwt-user',
        roles,
      };
    });
    // Mirrors the gateway: each domain is mounted inside register(..., { prefix: '/api/v1' }).
    await app.register(
      async (scope) => {
        await registerStaffHrRoutes(scope, { hrService, staffService, prefix: '/staff' });
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  it('denies canonical and encoded payroll export to a registrar', async () => {
    roles = ['registrar'];
    for (const url of [
      '/api/v1/staff/payroll/export?month=2026-09',
      '/api/v1/staff/%70ayroll/export?month=2026-09',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(403);
    }
  });

  it('allows payroll export for an hr_officer and HR reads for a registrar', async () => {
    roles = ['hr_officer'];
    const payroll = await app.inject({
      method: 'GET',
      url: '/api/v1/staff/payroll/export?month=2026-09',
    });
    expect(payroll.statusCode).toBe(200);
    roles = ['registrar'];
    const contracts = await app.inject({ method: 'GET', url: '/api/v1/staff/contracts' });
    expect(contracts.statusCode).toBe(200);
  });
});
