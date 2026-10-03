/**
 * PRC-H092: import progress is persisted per (tenantId, jobId) and polled
 * through a shared store, so a second gateway instance sees the same
 * progress and another tenant's job id never resolves.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { InMemoryImportQueue } from './in-memory-import-queue.js';
import { InMemoryStudentRepository } from './in-memory-student-repository.js';
import { registerImportRoutes } from './import-routes.js';
import { ImportService } from './import-service.js';
import {
  CacheImportProgressStore,
  InMemoryImportProgressStore,
  createImportProgressStoreFromEnv,
  type ImportProgressCache,
} from './progress-store.js';
import type { ImportProgressStore } from './types.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/** Shared fake Redis: one map seen by every "instance". */
function fakeRedis(): ImportProgressCache & { keys: () => string[] } {
  const data = new Map<string, string>();
  return {
    get: async <T>(key: string) => {
      const raw = data.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    set: async (key: string, value: unknown) => {
      data.set(key, JSON.stringify(value));
    },
    keys: () => [...data.keys()],
  };
}

async function gatewayInstance(store: ImportProgressStore, tenantId: () => string) {
  const queue = new InMemoryImportQueue(undefined, store);
  const service = new ImportService({
    studentRepository: new InMemoryStudentRepository(),
    importQueue: queue,
  });
  const app: FastifyInstance = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as FastifyRequest & { tenantId: string }).tenantId = tenantId();
  });
  await registerImportRoutes(app, { importService: service, prefix: '/students' });
  await app.ready();
  return { app, queue, service };
}

describe('PRC-H092 persisted, tenant-scoped import progress', () => {
  it.each([
    ['in-memory', () => new InMemoryImportProgressStore()],
    ['cache', () => new CacheImportProgressStore(fakeRedis())],
  ])('%s store merges updates and isolates tenants', async (_name, make) => {
    const store = make();
    const jobId = randomUUID();
    await store.update(TENANT_A, jobId, {
      jobId,
      status: 'queued',
      totalRows: 10,
      processedRows: 0,
      progressPercent: 0,
      startedAt: new Date().toISOString(),
    });
    await store.update(TENANT_A, jobId, { status: 'processing', progressPercent: 40 });
    expect(await store.get(TENANT_A, jobId)).toMatchObject({
      status: 'processing',
      totalRows: 10,
      progressPercent: 40,
    });
    expect(await store.get(TENANT_B, jobId)).toBeNull();
  });

  it('cache keys are tenant-namespaced', async () => {
    const redis = fakeRedis();
    const store = new CacheImportProgressStore(redis);
    const jobId = randomUUID();
    await store.update(TENANT_A, jobId, { jobId, status: 'queued' });
    expect(redis.keys()).toEqual([`t:${TENANT_A}:student-import:${jobId}`]);
  });

  it('a poll on a second instance returns the progress written by the first', async () => {
    const redis = fakeRedis();
    const writer = await gatewayInstance(new CacheImportProgressStore(redis), () => TENANT_A);
    const reader = await gatewayInstance(new CacheImportProgressStore(redis), () => TENANT_A);
    const jobId = randomUUID();
    // The writer instance processes the job (bad bytes ⇒ terminal `failed`).
    await writer.service.processQueuedImport(TENANT_A, jobId, Buffer.from('nope'), {
      duplicateResolution: 'skip',
    });
    const res = await reader.app.inject({ method: 'GET', url: `/students/import/${jobId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ jobId, status: 'failed', progressPercent: 100 });
    await writer.app.close();
    await reader.app.close();
  });

  it("another tenant polling the same job id gets 404", async () => {
    const redis = fakeRedis();
    let tenant = TENANT_A;
    const inst = await gatewayInstance(new CacheImportProgressStore(redis), () => tenant);
    const jobId = randomUUID();
    await inst.queue.updateProgress(TENANT_A, jobId, { jobId, status: 'queued' });
    expect((await inst.app.inject({ method: 'GET', url: `/students/import/${jobId}` })).statusCode).toBe(
      200,
    );
    tenant = TENANT_B;
    expect((await inst.app.inject({ method: 'GET', url: `/students/import/${jobId}` })).statusCode).toBe(
      404,
    );
    await inst.app.close();
  });

  it('env factory: in-memory without REDIS_URL, cache-backed with it', () => {
    expect(createImportProgressStoreFromEnv({})).toBeInstanceOf(InMemoryImportProgressStore);
    expect(
      createImportProgressStoreFromEnv({ REDIS_URL: 'redis://127.0.0.1:1' }),
    ).toBeInstanceOf(CacheImportProgressStore);
  });
});
