/**
 * Data Warehouse route tests (fastify.inject against the real plugin + in-memory repo).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dataWarehousePlugin } from './data-warehouse-plugin.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

async function buildApp(): Promise<FastifyInstance> {
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
    repository: new InMemoryWarehouseRepository(),
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

  it('isolates warehouses across tenants (404 cross-tenant)', async () => {
    const wh = await createWarehouse(TENANT_A);
    const res = await app.inject({
      method: 'GET',
      url: `/warehouses/${wh}`,
      headers: { 'x-tenant-id': TENANT_B },
    });
    expect(res.statusCode).toBe(404);
  });
});
