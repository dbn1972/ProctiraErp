/**
 * PRC-M576 — contract for every URL the web audit viewer builds
 * (apps/web/src/lib/api/audit.ts) against the plugin mounted exactly like
 * the gateway does (`prefix: '/api/v1/audit-logs'`).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditPlugin } from './audit-plugin.js';
import { InMemoryAuditRepository } from './in-memory-repository.js';

const PREFIX = '/api/v1/audit-logs';

async function buildApp(repository: InMemoryAuditRepository): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    const tenant = (request.headers['x-tenant-id'] as string | undefined) ?? 'tenant-a';
    (request as unknown as { tenantId: string }).tenantId = tenant;
    (request as unknown as { user: { sub: string; name: string } }).user = {
      sub: 'user-1',
      name: 'Asha Rao',
    };
  });
  await app.register(auditPlugin, { repository, prefix: PREFIX });
  await app.ready();
  return app;
}

describe('audit viewer contract (PRC-M576)', () => {
  let app: FastifyInstance;
  let entryId: string;

  beforeEach(async () => {
    const repository = new InMemoryAuditRepository();
    app = await buildApp(repository);
    const created = await app.inject({
      method: 'POST',
      url: PREFIX,
      payload: {
        entityType: 'student',
        entityId: 'stu-1',
        operation: 'UPDATE',
        beforeValues: { grade: '9' },
        afterValues: { grade: '10' },
      },
    });
    expect(created.statusCode).toBe(201);
    entryId = created.json().id;
    await app.inject({
      method: 'POST',
      url: PREFIX,
      headers: { 'x-tenant-id': 'tenant-b' },
      payload: { entityType: 'staff', entityId: 'st-9', operation: 'CREATE', afterValues: {} },
    });
  });
  afterEach(async () => {
    await app.close();
  });

  it('GET /audit-logs (listAuditEntries) returns data/meta with the viewer filters', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await app.inject({
      method: 'GET',
      url: `${PREFIX}?entityType=student&startDate=${today}&endDate=${today}&page=1&pageSize=25`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toMatchObject({ page: 1, pageSize: 25, totalItems: 1 });
    expect(body.data[0]).toMatchObject({
      id: entryId,
      userName: 'Asha Rao',
      beforeValues: { grade: '9' },
      afterValues: { grade: '10' },
    });
  });

  it('GET /audit-logs/:id (getAuditEntry) returns the entry', async () => {
    const res = await app.inject({ method: 'GET', url: `${PREFIX}/${entryId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(entryId);
  });

  it('GET /audit-logs/entity-types is tenant-scoped and not captured by /:id', async () => {
    const a = await app.inject({ method: 'GET', url: `${PREFIX}/entity-types` });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual({ data: ['student'] });
    const b = await app.inject({
      method: 'GET',
      url: `${PREFIX}/entity-types`,
      headers: { 'x-tenant-id': 'tenant-b' },
    });
    expect(b.json()).toEqual({ data: ['staff'] });
  });

  it('a second tenant sees none of the first tenant rows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: PREFIX,
      headers: { 'x-tenant-id': 'tenant-b' },
    });
    expect(res.json().data.map((e: { entityType: string }) => e.entityType)).toEqual(['staff']);
  });
});
