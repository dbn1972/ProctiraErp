/**
 * PRC-L157: deleting staff with HR/payroll history is blocked (409 -> offboard instead).
 */
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryStaffRepository } from './in-memory-repository.js';
import { PrismaStaffRepository } from './prisma-staff-repository.js';
import { registerStaffRoutes } from './routes.js';
import { StaffService } from './staff-service.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

async function mount() {
  const repo = new InMemoryStaffRepository();
  const service = new StaffService(repo);
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    const r = request as unknown as { tenantId: string; user: { roles: string[] } };
    r.tenantId = TENANT;
    r.user = { roles: ['hr_officer'] };
  });
  await registerStaffRoutes(app, { staffService: service });
  await app.ready();
  const staff = await service.create(TENANT, {
    firstName: 'Pat',
    lastName: 'Lee',
    dateOfBirth: '1985-06-15',
    identityNumber: `ID-${Math.random().toString(36).slice(2)}`,
    contactPhone: '+15550001111',
    position: 'Teacher',
  });
  return { app, repo, staffId: staff.id };
}

describe('PRC-L157 staff delete dependents guard', () => {
  it('DELETE staff with a payroll line -> 409 and the record survives', async () => {
    const { app, repo, staffId } = await mount();
    repo.recordDependent(TENANT, staffId, 'payrollLines');
    const res = await app.inject({ method: 'DELETE', url: `/staff/${staffId}` });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/payrollLines/);
    expect(res.json().message).toMatch(/offboard/);
    expect((await app.inject({ method: 'GET', url: `/staff/${staffId}` })).statusCode).toBe(200);
    await app.close();
  });

  it('DELETE staff without dependents -> 204', async () => {
    const { app, staffId } = await mount();
    expect((await app.inject({ method: 'DELETE', url: `/staff/${staffId}` })).statusCode).toBe(204);
    await app.close();
  });

  it('dependents in another tenant do not block (tenant-scoped count)', async () => {
    const { app, repo, staffId } = await mount();
    repo.recordDependent('660e8400-e29b-41d4-a716-446655440001', staffId, 'payrollLines');
    expect((await app.inject({ method: 'DELETE', url: `/staff/${staffId}` })).statusCode).toBe(204);
    await app.close();
  });

  it('Prisma countDependents queries only allowlisted tables with tenant + staff params', async () => {
    const calls: { sql: string; args: unknown[] }[] = [];
    const tx = {
      $executeRawUnsafe: vi.fn(async () => 0),
      $executeRaw: vi.fn(async () => 0),
      $queryRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
        calls.push({ sql, args });
        if (sql.includes('to_regclass'))
          return [{ present: args[0] === 'public.staff_payroll_lines' }];
        return [{ n: 2 }];
      }),
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const repo = new PrismaStaffRepository(prisma as never);
    const staffId = '770e8400-e29b-41d4-a716-446655440002';
    const counts = await repo.countDependents(staffId, TENANT);
    expect(counts).toEqual({ payrollLines: 2 });
    const countCalls = calls.filter((c) => c.sql.includes('COUNT(*)'));
    expect(countCalls).toHaveLength(1);
    expect(countCalls[0]!.sql).toContain('FROM staff_payroll_lines WHERE tenant_id = $1');
    expect(countCalls[0]!.args).toEqual([TENANT, staffId]);
  });
});
