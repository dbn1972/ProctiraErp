/**
 * PRC-L548 (topic 2 Option A): the import body must never carry database
 * credentials or a raw SQL query. A body with `dbConnectionConfig` (or any
 * other unknown key) is rejected with 400 before the service runs, and the
 * `db` format never reads connection details from the request.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataWarehouseService } from './data-warehouse-service.js';
import { dataWarehousePlugin } from './data-warehouse-plugin.js';
import { InMemoryWarehouseRepository } from './in-memory-repository.js';
const TENANT = 'tenant-a';
const CANARY_PASSWORD = 'canary-db-password-L548';
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId?: string }).tenantId = TENANT;
    (request as typeof request & { user?: unknown }).user = {
      sub: 'admin-1',
      tenantId: TENANT,
      roles: ['admin'],
    };
  });
  await app.register(dataWarehousePlugin, {
    repository: new InMemoryWarehouseRepository(),
    config: { maxImportBatchSize: 100 },
  });
  await app.ready();
  return app;
}
describe('PRC-L548 import body carries no credentials or raw SQL', () => {
  let app: FastifyInstance;
  let warehouseId: string;
  beforeEach(async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/warehouses', payload: { name: 'DW' } });
    expect(res.statusCode).toBe(201);
    warehouseId = (res.json() as { id: string }).id;
  });
  afterEach(async () => {
    await app.close();
  });
  it('rejects dbConnectionConfig (credentials + raw SQL) with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/warehouses/${warehouseId}/import`,
      payload: {
        format: 'db',
        dbConnectionConfig: {
          host: 'db.internal',
          port: 5432,
          database: 'source',
          username: 'reader',
          password: CANARY_PASSWORD,
          query: 'SELECT * FROM pg_shadow',
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('VALIDATION_ERROR');
    expect(res.payload).not.toContain(CANARY_PASSWORD);
  });
  it('rejects unknown top-level keys on the import body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/warehouses/${warehouseId}/import`,
      payload: {
        format: 'csv',
        fileContent: Buffer.from('x').toString('base64'),
        sql: 'DROP TABLE x',
      },
    });
    expect(res.statusCode).toBe(400);
  });
  it('db format without a body config returns a fixed import error (no connection attempt)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/warehouses/${warehouseId}/import`,
      payload: { format: 'db' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { errorCount: number; errors: Array<{ message: string }> };
    expect(body.errorCount).toBe(1);
    expect(body.errors[0]!.message).toMatch(/not accepted in the request body/i);
  });
  it('service ignores connection details even if a caller passes them programmatically', async () => {
    const repo = new InMemoryWarehouseRepository();
    const service = new DataWarehouseService(repo, { maxImportBatchSize: 10 });
    const wh = await service.createWarehouse(TENANT, { name: 'DW' });
    const result = await service.importData(TENANT, wh.id, 'db', {
      dbConnectionConfig: { password: CANARY_PASSWORD, query: 'SELECT 1' },
    } as never);
    expect(result.successCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain(CANARY_PASSWORD);
    expect(result.errors[0]!.message).toMatch(/not accepted in the request body/i);
  });
});
