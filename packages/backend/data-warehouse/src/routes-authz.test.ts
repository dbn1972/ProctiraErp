/**
 * PRC-M617 (topics 3/4 Option A, in-package guard; the package stays parked):
 * every warehouse route requires a verified principal, takes the tenant from
 * the principal's tenant claim (never from a request-supplied tenant), and
 * gates reads/writes by role.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { dataWarehousePlugin } from './data-warehouse-plugin.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
type Principal = { sub?: string; tenantId?: string; roles?: unknown };
async function buildApp(repository = new InMemoryWarehouseRepository()): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-test-principal'];
    if (typeof header === 'string') {
      (request as typeof request & { user?: Principal }).user = JSON.parse(header) as Principal;
    }
    const tenant = request.headers['x-tenant-id'];
    if (typeof tenant === 'string') {
      (request as typeof request & { tenantId?: string }).tenantId = tenant;
    }
  });
  await app.register(dataWarehousePlugin, { repository, config: { maxImportBatchSize: 10 } });
  await app.ready();
  return app;
}
const ADMIN_A: Principal = { sub: 'admin-a', tenantId: 'tenant-a', roles: ['admin'] };
const ADMIN_B: Principal = { sub: 'admin-b', tenantId: 'tenant-b', roles: ['admin'] };
const TEACHER_A: Principal = { sub: 'teacher-a', tenantId: 'tenant-a', roles: ['teacher'] };
const ANALYST_A: Principal = { sub: 'analyst-a', tenantId: 'tenant-a', roles: ['data_analyst'] };
function as(p: Principal, extra: Record<string, string> = {}) {
  return { 'x-test-principal': JSON.stringify(p), ...extra };
}
describe('PRC-M617 data-warehouse in-package authn/authz', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app.close();
  });
  it('401 without a verified principal, even when a tenant id is present', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/warehouses',
      headers: { 'x-tenant-id': 'tenant-a' },
    });
    expect(res.statusCode).toBe(401);
  });
  it('403 when the principal carries no tenant claim', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/warehouses',
      headers: as({ sub: 'admin', roles: ['admin'] }, { 'x-tenant-id': 'tenant-a' }),
    });
    expect(res.statusCode).toBe(403);
  });
  it('403 when the request tenant differs from the token tenant', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/warehouses',
      headers: as(ADMIN_A, { 'x-tenant-id': 'tenant-b' }),
    });
    expect(res.statusCode).toBe(403);
  });
  it('uses the token tenant when no request tenant was resolved', async () => {
    app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/warehouses',
      headers: as(ADMIN_A),
      payload: { name: 'A-DW' },
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { tenantId: string }).tenantId).toBe('tenant-a');
    const listB = await app.inject({ method: 'GET', url: '/warehouses', headers: as(ADMIN_B) });
    expect(listB.statusCode).toBe(200);
    expect((listB.json() as { data: unknown[] }).data).toHaveLength(0);
  });
  it('403 for a role with no warehouse access (read and write)', async () => {
    app = await buildApp();
    const read = await app.inject({ method: 'GET', url: '/warehouses', headers: as(TEACHER_A) });
    expect(read.statusCode).toBe(403);
    const write = await app.inject({
      method: 'POST',
      url: '/warehouses',
      headers: as(TEACHER_A),
      payload: { name: 'X' },
    });
    expect(write.statusCode).toBe(403);
  });
  it('read-only analyst may list/query but not create', async () => {
    app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/warehouses',
      headers: as(ADMIN_A),
      payload: { name: 'A-DW' },
    });
    const id = (created.json() as { id: string }).id;
    const list = await app.inject({ method: 'GET', url: '/warehouses', headers: as(ANALYST_A) });
    expect(list.statusCode).toBe(200);
    const query = await app.inject({
      method: 'POST',
      url: `/warehouses/${id}/query`,
      headers: as(ANALYST_A),
      payload: {},
    });
    expect(query.statusCode).toBe(200);
    const write = await app.inject({
      method: 'POST',
      url: '/warehouses',
      headers: as(ANALYST_A),
      payload: { name: 'X' },
    });
    expect(write.statusCode).toBe(403);
  });
});
