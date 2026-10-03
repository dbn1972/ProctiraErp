import { Readable } from 'node:stream';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdapterHealth, StorageAdapter, StorageResult } from '@proctira/storage';

import storageHealthPlugin, {
  buildStorageAdapterConfig,
  isStorageConfigured,
  readStorageEnv,
  runStorageHealthProbe,
} from './storage-health.js';

function mockAdapter(overrides?: Partial<StorageAdapter>): StorageAdapter {
  const health: AdapterHealth = {
    healthy: true,
    message: 'bucket ok',
    latencyMs: 3,
    adapter: 'minio',
    checkedAt: new Date('2026-09-07T18:00:00.000Z'),
  };
  const uploaded: StorageResult = {
    key: 'tenants/system-health/probes/x.txt',
    bucket: 'proctira',
  };
  return {
    healthCheck: vi.fn(async () => health),
    upload: vi.fn(async () => uploaded),
    download: vi.fn(async () => Readable.from([Buffer.from('ok')])),
    delete: vi.fn(async () => undefined),
    getSignedUrl: vi.fn(async () => 'https://example'),
    listObjects: vi.fn(async () => ({ objects: [], isTruncated: false })),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('storage env helpers', () => {
  it('requires bucket + keys before claiming configured', () => {
    expect(isStorageConfigured(readStorageEnv({}))).toBe(false);
    expect(
      isStorageConfigured(
        readStorageEnv({
          S3_BUCKET: 'proctira',
          S3_ACCESS_KEY: 'proctira',
          S3_SECRET_KEY: 'secret',
          S3_ENDPOINT: 'http://minio:9000',
        }),
      ),
    ).toBe(true);
  });

  it('builds MinIO config when endpoint is set', () => {
    const config = buildStorageAdapterConfig(
      readStorageEnv({
        S3_BUCKET: 'proctira',
        S3_ACCESS_KEY: 'ak',
        S3_SECRET_KEY: 'sk',
        S3_ENDPOINT: 'http://minio:9000',
        S3_REGION: 'us-east-1',
      }),
    );
    expect(config?.adapter).toBe('minio');
  });
});

describe('runStorageHealthProbe', () => {
  it('fails round-trip when payload mismatches', async () => {
    const adapter = mockAdapter({
      download: vi.fn(async () => Readable.from([Buffer.from('wrong')])),
    });
    const result = await runStorageHealthProbe(adapter);
    expect(result.healthy).toBe(false);
    expect(result.message).toMatch(/mismatch/i);
  });

  it('succeeds when uploaded bytes match download', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T00:00:00.000Z'));
    const expected = Buffer.from('proctira-storage-probe:2026-09-07T00:00:00.000Z', 'utf8');
    const adapter = mockAdapter({
      download: vi.fn(async () => Readable.from([expected])),
    });
    const result = await runStorageHealthProbe(adapter);
    expect(result.healthy).toBe(true);
    expect(result.roundTrip).toBe(true);
    expect(result.message).toBe('Object storage read/write verified');
  });
});

describe('GET /api/v1/storage/health', () => {
  it('returns 503 when adapter is null (unconfigured)', async () => {
    const app = Fastify();
    await app.register(storageHealthPlugin, { adapter: null, authorize: () => 'ok' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/v1/storage/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ mode: 'unconfigured' });
    await app.close();
  });

  it('returns 200 when live adapter round-trip succeeds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T00:00:00.000Z'));
    const expected = Buffer.from('proctira-storage-probe:2026-09-07T00:00:00.000Z', 'utf8');
    const adapter = mockAdapter({
      download: vi.fn(async () => Readable.from([expected])),
    });

    const app = Fastify();
    await app.register(storageHealthPlugin, { adapter, roundTrip: true, authorize: () => 'ok' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/v1/storage/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      mode: 'live',
      roundTrip: true,
      message: 'Object storage read/write verified',
    });
    await app.close();
  });
});

describe('GET /api/v1/storage/health exposure (PRC-M023)', () => {
  it('anonymous → 401 and non-platform user → 403 by default; adapter untouched', async () => {
    const adapter = mockAdapter();
    const app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (req) => {
      const role = req.headers['x-role'] as string | undefined;
      if (role) (req as unknown as { user: unknown }).user = { roles: [{ roleId: role }] };
    });
    await app.register(storageHealthPlugin, { adapter });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/v1/storage/health' })).statusCode).toBe(
      401,
    );
    const teacher = await app.inject({
      method: 'GET',
      url: '/api/v1/storage/health',
      headers: { 'x-role': 'teacher' },
    });
    expect(teacher.statusCode).toBe(403);
    expect(adapter.healthCheck).not.toHaveBeenCalled();
    const admin = await app.inject({
      method: 'GET',
      url: '/api/v1/storage/health',
      headers: { 'x-role': 'super-admin' },
    });
    expect(admin.statusCode).toBe(200);
    // Default is HeadBucket only — no bucket writes.
    expect(adapter.upload).not.toHaveBeenCalled();
    expect(admin.json().roundTrip).toBe(false);
    await app.close();
  });

  it('failure body contains no endpoint/bucket/SDK text and results are cached', async () => {
    const adapter = mockAdapter({
      healthCheck: vi.fn(async () => ({
        healthy: false,
        message: 'connect ECONNREFUSED minio.internal:9000 bucket proctira-prod',
        latencyMs: 1,
        adapter: 'minio',
        checkedAt: new Date(),
      })),
    });
    const app = Fastify();
    await app.register(storageHealthPlugin, { adapter, authorize: () => 'ok' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/v1/storage/health' });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toMatch(/minio\.internal|proctira-prod|ECONNREFUSED|9000/);
    await app.inject({ method: 'GET', url: '/api/v1/storage/health' });
    expect(adapter.healthCheck).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('round-trip failure detail is not returned', async () => {
    const adapter = mockAdapter({
      upload: vi.fn(async () => {
        throw new Error('AccessDenied: arn:aws:s3:::proctira-secret-bucket');
      }),
    });
    const app = Fastify();
    await app.register(storageHealthPlugin, { adapter, roundTrip: true, authorize: () => 'ok' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/v1/storage/health' });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('proctira-secret-bucket');
    await app.close();
  });
});
