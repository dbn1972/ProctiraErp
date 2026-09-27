/**
 * Unit tests for the scalability admin routes (`scalability-routes.ts`).
 *
 * This package is intentionally parked — it is not mounted at the API
 * gateway (see `mount-matrix.ts`). These tests exercise the route
 * handlers' business logic in isolation, through `app.inject()`, using
 * plain object-literal test doubles for `CacheClient` and `QueueAdapter`
 * so no real Redis/Kafka connection is required.
 */

import type { CacheClient, CacheMetrics } from '@proctira/cache';
import type { HealthCheckResult, QueueAdapter } from '@proctira/queue-abstraction';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerScalabilityRoutes } from './scalability-routes.js';

const BASE = '/api/v1/admin/scalability';

/**
 * Builds a mock `CacheClient`. Only the three methods the routes call
 * (`getMetrics`, `isHealthy`, `invalidatePattern`) are implemented —
 * `CacheClient` is a concrete class with private fields, so the mock is
 * cast via `unknown` since it satisfies the methods actually used and
 * not the class's private implementation details.
 */
function buildMockCache(overrides?: {
  metrics?: CacheMetrics;
  healthy?: boolean;
  invalidatePattern?: (pattern: string) => Promise<number>;
}): {
  cache: CacheClient;
  getMetrics: ReturnType<typeof vi.fn>;
  isHealthy: ReturnType<typeof vi.fn>;
  invalidatePattern: ReturnType<typeof vi.fn>;
} {
  const getMetrics = vi.fn(
    (): CacheMetrics => overrides?.metrics ?? { hits: 0, misses: 0, errors: 0 },
  );
  const isHealthy = vi.fn(async (): Promise<boolean> => overrides?.healthy ?? true);
  const invalidatePattern = vi.fn(overrides?.invalidatePattern ?? (async (): Promise<number> => 0));

  const cache = {
    getMetrics,
    isHealthy,
    invalidatePattern,
  } as unknown as CacheClient;

  return { cache, getMetrics, isHealthy, invalidatePattern };
}

/**
 * Builds a mock `QueueAdapter`. Only `healthCheck` and `isConnected` are
 * implemented — those are the only two methods the routes call.
 */
function buildMockQueue(overrides?: { healthCheck?: HealthCheckResult; connected?: boolean }): {
  queue: QueueAdapter;
  healthCheck: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
} {
  const healthCheck = vi.fn(
    async (): Promise<HealthCheckResult> =>
      overrides?.healthCheck ?? { healthy: true, backend: 'kafka' },
  );
  const isConnected = vi.fn((): boolean => overrides?.connected ?? true);

  const queue = {
    healthCheck,
    isConnected,
  } as unknown as QueueAdapter;

  return { queue, healthCheck, isConnected };
}

interface HarnessOptions {
  cache?: ReturnType<typeof buildMockCache>;
  queue?: ReturnType<typeof buildMockQueue>;
  isAdmin?: (request: FastifyRequest) => boolean | Promise<boolean>;
}

interface Harness {
  app: FastifyInstance;
  cacheMock: ReturnType<typeof buildMockCache>;
  queueMock: ReturnType<typeof buildMockQueue>;
}

async function buildHarness(options?: HarnessOptions): Promise<Harness> {
  const app = Fastify();
  const cacheMock = options?.cache ?? buildMockCache();
  const queueMock = options?.queue ?? buildMockQueue();

  await registerScalabilityRoutes(app, {
    cache: cacheMock.cache,
    queue: queueMock.queue,
    isAdmin: options?.isAdmin,
  });
  await app.ready();

  return { app, cacheMock, queueMock };
}

describe('scalability routes', () => {
  describe(`GET ${BASE}/cache`, () => {
    it('returns hitRate 0 (not NaN) when hits and misses are both zero', async () => {
      const { app } = await buildHarness({
        cache: buildMockCache({ metrics: { hits: 0, misses: 0, errors: 0 } }),
      });

      const response = await app.inject({ method: 'GET', url: `${BASE}/cache` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.hitRate).toBe(0);
      expect(Number.isNaN(body.hitRate)).toBe(false);
    });

    it('rounds hitRate to 4 decimal places for a fraction that would otherwise repeat', async () => {
      // 1 hit / 3 total = 0.333333... -> rounds to 0.3333
      const { app } = await buildHarness({
        cache: buildMockCache({ metrics: { hits: 1, misses: 2, errors: 0 } }),
      });

      const response = await app.inject({ method: 'GET', url: `${BASE}/cache` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.hitRate).toBe(0.3333);
    });

    it('passes through errors and healthy unchanged from the mock', async () => {
      const { app } = await buildHarness({
        cache: buildMockCache({
          metrics: { hits: 7, misses: 3, errors: 5 },
          healthy: false,
        }),
      });

      const response = await app.inject({ method: 'GET', url: `${BASE}/cache` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.hits).toBe(7);
      expect(body.misses).toBe(3);
      expect(body.errors).toBe(5);
      expect(body.hitRate).toBe(0.7);
      expect(body.healthy).toBe(false);
    });
  });

  describe(`GET ${BASE}/queue`, () => {
    it('passes through connected, healthy, backend, latencyMs, and error unchanged', async () => {
      const { app } = await buildHarness({
        queue: buildMockQueue({
          connected: true,
          healthCheck: { healthy: true, backend: 'kafka', latencyMs: 42, error: undefined },
        }),
      });

      const response = await app.inject({ method: 'GET', url: `${BASE}/queue` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.connected).toBe(true);
      expect(body.healthy).toBe(true);
      expect(body.backend).toBe('kafka');
      expect(body.latencyMs).toBe(42);
      expect(body.error).toBeUndefined();
    });

    it('reflects disconnected/unhealthy state with an error message and no latencyMs', async () => {
      const { app } = await buildHarness({
        queue: buildMockQueue({
          connected: false,
          healthCheck: { healthy: false, backend: 'rabbitmq', error: 'connection refused' },
        }),
      });

      const response = await app.inject({ method: 'GET', url: `${BASE}/queue` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.connected).toBe(false);
      expect(body.healthy).toBe(false);
      expect(body.backend).toBe('rabbitmq');
      expect(body.latencyMs).toBeUndefined();
      expect(body.error).toBe('connection refused');
    });
  });

  describe(`GET ${BASE}/health`, () => {
    it("reports status 'healthy' when both cache and queue are healthy", async () => {
      const { app } = await buildHarness({
        cache: buildMockCache({ metrics: { hits: 4, misses: 1, errors: 0 }, healthy: true }),
        queue: buildMockQueue({ healthCheck: { healthy: true, backend: 'kafka', latencyMs: 5 } }),
      });

      const response = await app.inject({ method: 'GET', url: `${BASE}/health` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('healthy');
    });

    it("reports status 'degraded' when cache is unhealthy but queue is healthy", async () => {
      const { app } = await buildHarness({
        cache: buildMockCache({ healthy: false }),
        queue: buildMockQueue({ healthCheck: { healthy: true, backend: 'kafka' } }),
      });

      const response = await app.inject({ method: 'GET', url: `${BASE}/health` });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('degraded');
    });

    it("reports status 'degraded' when queue is unhealthy but cache is healthy", async () => {
      const { app } = await buildHarness({
        cache: buildMockCache({ healthy: true }),
        queue: buildMockQueue({ healthCheck: { healthy: false, backend: 'sqs' } }),
      });

      const response = await app.inject({ method: 'GET', url: `${BASE}/health` });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('degraded');
    });

    it("reports status 'unhealthy' when both cache and queue are unhealthy", async () => {
      const { app } = await buildHarness({
        cache: buildMockCache({ healthy: false }),
        queue: buildMockQueue({ healthCheck: { healthy: false, backend: 'kafka' } }),
      });

      const response = await app.inject({ method: 'GET', url: `${BASE}/health` });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('unhealthy');
    });

    it('nests cache and queue sub-objects correctly and returns a valid ISO-8601 timestamp', async () => {
      const { app } = await buildHarness({
        cache: buildMockCache({ metrics: { hits: 9, misses: 1, errors: 2 }, healthy: true }),
        queue: buildMockQueue({
          connected: true,
          healthCheck: { healthy: true, backend: 'kafka', latencyMs: 12 },
        }),
      });

      const response = await app.inject({ method: 'GET', url: `${BASE}/health` });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.cache).toEqual({
        hits: 9,
        misses: 1,
        errors: 2,
        hitRate: 0.9,
        healthy: true,
      });
      expect(body.queue).toEqual({
        connected: true,
        healthy: true,
        backend: 'kafka',
        latencyMs: 12,
      });

      expect(typeof body.timestamp).toBe('string');
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });
  });

  describe(`POST ${BASE}/cache/flush`, () => {
    it('invalidates all 3 tenant-scoped patterns and sums keysDeleted when no isAdmin is configured', async () => {
      const invalidatePattern = vi
        .fn<[string], Promise<number>>()
        .mockResolvedValueOnce(3) // t:tenant-1:*
        .mockResolvedValueOnce(2) // lst:tenant-1:*
        .mockResolvedValueOnce(7); // cfg:tenant-1:*

      const { app } = await buildHarness({
        cache: buildMockCache({ invalidatePattern }),
      });

      const response = await app.inject({
        method: 'POST',
        url: `${BASE}/cache/flush`,
        payload: { tenantId: 'tenant-1' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.tenantId).toBe('tenant-1');
      expect(body.keysDeleted).toBe(12);
      expect(typeof body.timestamp).toBe('string');

      expect(invalidatePattern).toHaveBeenCalledTimes(3);
      expect(invalidatePattern).toHaveBeenNthCalledWith(1, 't:tenant-1:*');
      expect(invalidatePattern).toHaveBeenNthCalledWith(2, 'lst:tenant-1:*');
      expect(invalidatePattern).toHaveBeenNthCalledWith(3, 'cfg:tenant-1:*');
    });

    it('returns 400 with an explanatory error when tenantId is missing', async () => {
      const { app, cacheMock } = await buildHarness();

      const response = await app.inject({
        method: 'POST',
        url: `${BASE}/cache/flush`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'tenantId is required in request body' });
      expect(cacheMock.invalidatePattern).not.toHaveBeenCalled();
    });

    it('returns 400 when tenantId is present but not a string (e.g. a number)', async () => {
      const { app, cacheMock } = await buildHarness();

      const response = await app.inject({
        method: 'POST',
        url: `${BASE}/cache/flush`,
        payload: { tenantId: 12345 },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'tenantId is required in request body' });
      expect(cacheMock.invalidatePattern).not.toHaveBeenCalled();
    });

    it('returns 403 and does not touch the cache when isAdmin resolves false', async () => {
      const { app, cacheMock } = await buildHarness({
        isAdmin: async () => false,
      });

      const response = await app.inject({
        method: 'POST',
        url: `${BASE}/cache/flush`,
        payload: { tenantId: 'tenant-1' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'Forbidden: admin access required' });
      expect(cacheMock.invalidatePattern).not.toHaveBeenCalled();
    });

    it('proceeds to 200 when isAdmin (async) resolves true, same as the no-isAdmin case', async () => {
      const { app, cacheMock } = await buildHarness({
        isAdmin: async () => true,
      });

      const response = await app.inject({
        method: 'POST',
        url: `${BASE}/cache/flush`,
        payload: { tenantId: 'tenant-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(cacheMock.invalidatePattern).toHaveBeenCalledTimes(3);
    });

    it('proceeds to 200 when isAdmin returns a plain boolean (not a Promise)', async () => {
      // The handler does `await isAdmin(request)` unconditionally, so a
      // synchronous boolean return must work identically to an async one.
      const { app, cacheMock } = await buildHarness({
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous to test the non-Promise path
        isAdmin: () => true,
      });

      const response = await app.inject({
        method: 'POST',
        url: `${BASE}/cache/flush`,
        payload: { tenantId: 'tenant-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(cacheMock.invalidatePattern).toHaveBeenCalledTimes(3);
    });

    it('rejects with 403 when isAdmin returns a plain false (not wrapped in a Promise)', async () => {
      const { app, cacheMock } = await buildHarness({
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous to test the non-Promise path
        isAdmin: () => false,
      });

      const response = await app.inject({
        method: 'POST',
        url: `${BASE}/cache/flush`,
        payload: { tenantId: 'tenant-1' },
      });

      expect(response.statusCode).toBe(403);
      expect(cacheMock.invalidatePattern).not.toHaveBeenCalled();
    });
  });
});
