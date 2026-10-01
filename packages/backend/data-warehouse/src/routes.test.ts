/**
 * Data Warehouse route tests (fastify.inject against the real plugin + in-memory repo).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dataWarehousePlugin } from './data-warehouse-plugin.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

async function buildApp(
  repository: InMemoryWarehouseRepository = new InMemoryWarehouseRepository(),
): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    const tenant = request.headers['x-tenant-id'];
    if (typeof tenant === 'string') {
      (request as typeof request & { tenantId?: string }).tenantId = tenant;
    }
    const actor = request.headers['x-actor-id'];
    if (typeof actor === 'string') {
      (request as typeof request & { user?: { sub: string } }).user = { sub: actor };
    }
  });
  await app.register(dataWarehousePlugin, {
    repository,
    config: { maxImportBatchSize: 1000 },
  });
  await app.ready();
  return app;
}

describe('data-warehouse routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  async function createWarehouse(tenant = TENANT_A): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/warehouses',
      headers: { 'x-tenant-id': tenant },
      payload: { name: 'DW' },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  describe('time periods (PRC-L454)', () => {
    it('rejects an unparseable startDate with 400', async () => {
      const wh = await createWarehouse();
      const res = await app.inject({
        method: 'POST',
        url: `/warehouses/${wh}/time-periods`,
        headers: { 'x-tenant-id': TENANT_A },
        payload: { timePeriod: '2024', startDate: 'abc' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an impossible calendar date with 400', async () => {
      const wh = await createWarehouse();
      const res = await app.inject({
        method: 'POST',
        url: `/warehouses/${wh}/time-periods`,
        headers: { 'x-tenant-id': TENANT_A },
        payload: { timePeriod: '2024', startDate: '2024-02-31' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects endDate before startDate with 400', async () => {
      const wh = await createWarehouse();
      const res = await app.inject({
        method: 'POST',
        url: `/warehouses/${wh}/time-periods`,
        headers: { 'x-tenant-id': TENANT_A },
        payload: { timePeriod: '2024', startDate: '2024-12-31', endDate: '2024-01-01' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts a valid period', async () => {
      const wh = await createWarehouse();
      const res = await app.inject({
        method: 'POST',
        url: `/warehouses/${wh}/time-periods`,
        headers: { 'x-tenant-id': TENANT_A },
        payload: { timePeriod: '2024', startDate: '2024-01-01', endDate: '2024-12-31' },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('list query validation (PRC-L455)', () => {
    it('rejects pageSize above 100 with 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/warehouses?pageSize=101',
        headers: { 'x-tenant-id': TENANT_A },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects page=0 and negative page with 400', async () => {
      for (const page of ['0', '-1', 'abc']) {
        const res = await app.inject({
          method: 'GET',
          url: `/warehouses?page=${page}`,
          headers: { 'x-tenant-id': TENANT_A },
        });
        expect(res.statusCode).toBe(400);
      }
    });

    it('validates sub-resource list queries too', async () => {
      const wh = await createWarehouse();
      for (const sub of ['indicators', 'units', 'subgroups', 'time-periods', 'areas']) {
        const res = await app.inject({
          method: 'GET',
          url: `/warehouses/${wh}/${sub}?pageSize=500`,
          headers: { 'x-tenant-id': TENANT_A },
        });
        expect(res.statusCode).toBe(400);
      }
    });

    it('coerces valid numeric strings', async () => {
      await createWarehouse();
      const res = await app.inject({
        method: 'GET',
        url: '/warehouses?page=1&pageSize=100',
        headers: { 'x-tenant-id': TENANT_A },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { meta: { pageSize: number } }).meta.pageSize).toBe(100);
    });
  });

  it('isolates warehouses across tenants (404 cross-tenant)', async () => {
    const wh = await createWarehouse(TENANT_A);
    const res = await app.inject({
      method: 'GET',
      url: `/warehouses/${wh}`,
      headers: { 'x-tenant-id': TENANT_B },
    });
    expect(res.statusCode).toBe(404);
  });

  describe('typed errors (PRC-L551)', () => {
    it('returns 404 when a warehouse is deleted concurrently between check and delete', async () => {
      const repo = new InMemoryWarehouseRepository();
      const local = await buildApp(repo);
      try {
        const created = await local.inject({
          method: 'POST',
          url: '/warehouses',
          headers: { 'x-tenant-id': TENANT_A },
          payload: { name: 'DW' },
        });
        const id = (created.json() as { id: string }).id;
        const stale = await repo.findWarehouseById(id, TENANT_A);
        // Simulate a concurrent delete: the service's existence check sees a stale row.
        await repo.deleteWarehouse(id, TENANT_A);
        repo.findWarehouseById = async () => stale;
        const res = await local.inject({
          method: 'DELETE',
          url: `/warehouses/${id}`,
          headers: { 'x-tenant-id': TENANT_A },
        });
        expect(res.statusCode).toBe(404);
      } finally {
        await local.close();
      }
    });

    it('does not leak internal error messages on unexpected failures', async () => {
      const repo = new InMemoryWarehouseRepository();
      repo.listWarehouses = async () => {
        throw new Error('db password=secret');
      };
      const local = await buildApp(repo);
      try {
        const res = await local.inject({
          method: 'GET',
          url: '/warehouses',
          headers: { 'x-tenant-id': TENANT_A },
        });
        expect(res.statusCode).toBe(500);
        expect(res.body).not.toContain('secret');
      } finally {
        await local.close();
      }
    });
  });
});
