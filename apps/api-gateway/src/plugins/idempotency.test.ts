import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import idempotencyPlugin, {
  InMemoryIdempotencyStore,
  isCacheableIdempotentStatus,
  type RedisClient,
} from './idempotency.js';

/**
 * In-memory Redis mock for testing the idempotency plugin.
 */
function createMockRedis(): RedisClient & {
  store: Map<string, { value: string; expiresAt?: number }>;
} {
  const store = new Map<string, { value: string; expiresAt?: number }>();

  return {
    store,
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
      let expiresAt: number | undefined;
      // Handle 'EX' ttl argument
      if (args[0] === 'EX' && typeof args[1] === 'number') {
        expiresAt = Date.now() + args[1] * 1000;
      }
      // SET ... NX (PRC-M019)
      if (args.includes('NX')) {
        const existing = store.get(key);
        if (existing && !(existing.expiresAt && Date.now() > existing.expiresAt)) return null;
      }
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    async del(key: string | string[]): Promise<number> {
      const keys = Array.isArray(key) ? key : [key];
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    },
  };
}

describe('idempotencyPlugin', () => {
  let app: FastifyInstance;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    app = Fastify();
    redis = createMockRedis();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('basic behavior', () => {
    it('should pass through requests without Idempotency-Key header', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis });
      app.post('/test', async () => {
        callCount++;
        return { result: 'created' };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/test',
        payload: { name: 'test' },
      });

      expect(response.statusCode).toBe(200);
      expect(callCount).toBe(1);
    });

    it('should execute handler on first request with Idempotency-Key', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis });
      app.post('/test', async () => {
        callCount++;
        return { result: 'created', id: '123' };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'unique-key-1' },
        payload: { name: 'test' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ result: 'created', id: '123' });
      expect(callCount).toBe(1);
    });

    it('should return cached response on duplicate Idempotency-Key', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis });
      app.post('/test', async (_req, reply) => {
        callCount++;
        return reply.status(201).send({ result: 'created', id: '456' });
      });

      // First request
      const response1 = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'dup-key-1' },
        payload: { name: 'test' },
      });

      expect(response1.statusCode).toBe(201);
      expect(response1.json()).toEqual({ result: 'created', id: '456' });
      expect(callCount).toBe(1);

      // Second request with same key — should return cached response
      const response2 = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'dup-key-1' },
        payload: { name: 'test' },
      });

      expect(response2.statusCode).toBe(201);
      expect(response2.json()).toEqual({ result: 'created', id: '456' });
      expect(response2.headers['x-idempotency-replay']).toBe('true');
      expect(callCount).toBe(1); // Handler NOT called again
    });

    it('should not apply to GET requests', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis });
      app.get('/test', async () => {
        callCount++;
        return { data: 'fetched' };
      });

      await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'idempotency-key': 'get-key-1' },
      });

      await app.inject({
        method: 'GET',
        url: '/test',
        headers: { 'idempotency-key': 'get-key-1' },
      });

      expect(callCount).toBe(2); // Both calls executed
    });

    it('should apply to PUT requests', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis });
      app.put('/test/:id', async () => {
        callCount++;
        return { result: 'updated' };
      });

      await app.inject({
        method: 'PUT',
        url: '/test/1',
        headers: { 'idempotency-key': 'put-key-1' },
        payload: { name: 'updated' },
      });

      await app.inject({
        method: 'PUT',
        url: '/test/1',
        headers: { 'idempotency-key': 'put-key-1' },
        payload: { name: 'updated' },
      });

      expect(callCount).toBe(1); // Only first call executed
    });

    it('should apply to PATCH requests', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis });
      app.patch('/test/:id', async () => {
        callCount++;
        return { result: 'patched' };
      });

      await app.inject({
        method: 'PATCH',
        url: '/test/1',
        headers: { 'idempotency-key': 'patch-key-1' },
        payload: { name: 'patched' },
      });

      await app.inject({
        method: 'PATCH',
        url: '/test/1',
        headers: { 'idempotency-key': 'patch-key-1' },
        payload: { name: 'patched' },
      });

      expect(callCount).toBe(1); // Only first call executed
    });
  });

  describe('concurrent request handling (409 Conflict)', () => {
    it('should return 409 when a request with the same key is in-flight', async () => {
      await app.register(idempotencyPlugin, { redis, lockTtlSeconds: 30 });

      // Simulate an in-flight request by setting the lock directly
      const tenantId = 'global';
      const key = 'concurrent-key-1';
      const lockKey = `idempotency:${tenantId}:anon:${key}:lock`;
      await redis.set(lockKey, 'processing', 'EX', 30);

      app.post('/test', async () => {
        return { result: 'created' };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': key },
        payload: { name: 'test' },
      });

      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(body.message).toContain('already being processed');
    });
  });

  describe('tenant scoping', () => {
    it('should scope idempotency keys per tenant', async () => {
      let callCount = 0;

      // Register tenant resolution BEFORE idempotency plugin so tenantId is set first
      app.decorateRequest('tenantId', '');
      app.addHook('onRequest', async (request) => {
        const tenantHeader = request.headers['x-tenant-id'] as string | undefined;
        if (tenantHeader) {
          (request as unknown as { tenantId: string }).tenantId = tenantHeader;
        }
      });

      await app.register(idempotencyPlugin, { redis });

      app.post('/test', async () => {
        callCount++;
        return { result: 'created' };
      });

      // Request from tenant A
      await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'shared-key', 'x-tenant-id': 'tenant-a' },
        payload: { name: 'test' },
      });

      // Same key from tenant B — should execute (different tenant scope)
      await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'shared-key', 'x-tenant-id': 'tenant-b' },
        payload: { name: 'test' },
      });

      expect(callCount).toBe(2); // Both executed (different tenants)
    });
  });

  describe('error handling', () => {
    it('should not cache 5xx responses', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis });
      app.post('/test', async (_req, reply) => {
        callCount++;
        if (callCount === 1) {
          return reply.status(500).send({ error: 'Internal error' });
        }
        return reply.status(201).send({ result: 'created' });
      });

      // First request — 500 error
      const response1 = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'error-key-1' },
        payload: { name: 'test' },
      });
      expect(response1.statusCode).toBe(500);

      // Second request with same key — should execute again (not cached)
      const response2 = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'error-key-1' },
        payload: { name: 'test' },
      });
      expect(response2.statusCode).toBe(201);
      expect(callCount).toBe(2);
    });

    it('should cache 4xx responses', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis });
      app.post('/test', async (_req, reply) => {
        callCount++;
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Bad input' });
      });

      // First request — 400 error
      await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'bad-key-1' },
        payload: { name: '' },
      });

      // Second request — should return cached 400
      const response2 = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'bad-key-1' },
        payload: { name: '' },
      });

      expect(response2.statusCode).toBe(400);
      expect(response2.headers['x-idempotency-replay']).toBe('true');
      expect(callCount).toBe(1);
    });

    it('should release lock when handler throws an error', async () => {
      await app.register(idempotencyPlugin, { redis });
      app.post('/test', async () => {
        throw new Error('Handler exploded');
      });

      // First request — handler throws
      await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'throw-key-1' },
        payload: { name: 'test' },
      });

      // Verify the lock was released
      const lockKey = 'idempotency:global:anon:throw-key-1:lock';
      const lockValue = await redis.get(lockKey);
      expect(lockValue).toBeNull();
    });
  });

  describe('excluded paths', () => {
    it('should not apply idempotency to excluded paths', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, {
        redis,
        excludePaths: ['/health', '/api/v1/auth/*'],
      });

      app.post('/health', async () => {
        callCount++;
        return { status: 'ok' };
      });

      await app.inject({
        method: 'POST',
        url: '/health',
        headers: { 'idempotency-key': 'health-key' },
        payload: {},
      });

      await app.inject({
        method: 'POST',
        url: '/health',
        headers: { 'idempotency-key': 'health-key' },
        payload: {},
      });

      expect(callCount).toBe(2); // Both executed (excluded path)
    });
  });

  describe('explicit in-memory store (dev/test)', () => {
    it('still deduplicates within the process when storeMode=memory', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { storeMode: 'memory' });
      app.post('/test', async () => {
        callCount++;
        return { result: 'created' };
      });

      const first = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'no-redis-key' },
        payload: { name: 'test' },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'no-redis-key' },
        payload: { name: 'test' },
      });

      expect(first.headers['x-idempotency-replay']).toBeUndefined();
      expect(second.headers['x-idempotency-replay']).toBe('true');
      expect(callCount).toBe(1);
    });

    it('InMemoryIdempotencyStore honours EX ttl and bounds entries', async () => {
      vi.useFakeTimers();
      try {
        const store = new InMemoryIdempotencyStore(2);
        await store.set('a', '1', 'EX', 1);
        expect(await store.get('a')).toBe('1');
        vi.advanceTimersByTime(1500);
        expect(await store.get('a')).toBeNull();

        await store.set('x', '1');
        await store.set('y', '2');
        await store.set('z', '3');
        expect(store.size).toBe(2);
        expect(await store.get('x')).toBeNull();
        expect(await store.get('z')).toBe('3');
        expect(await store.del(['y', 'z'])).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('W1-ARCH-03 fail-closed (no silent memory degrade)', () => {
    it('refuses to register redis mode without a Redis client', async () => {
      await expect(
        app.register(idempotencyPlugin, { storeMode: 'redis', redis: undefined }),
      ).rejects.toThrow(/refusing silent in-memory fallback/i);
    });

    it('returns 503 when Redis get fails under redis storeMode', async () => {
      let callCount = 0;
      const failingRedis: RedisClient = {
        async get() {
          throw new Error('ECONNREFUSED');
        },
        async set() {
          return 'OK';
        },
        async del() {
          return 0;
        },
      };

      await app.register(idempotencyPlugin, { storeMode: 'redis', redis: failingRedis });
      app.post('/test', async () => {
        callCount++;
        return { result: 'created' };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'redis-down-key' },
        payload: { name: 'test' },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe('IDEMPOTENCY_STORE_UNAVAILABLE');
      expect(callCount).toBe(0);
    });

    it('returns 503 when Redis set (lock acquire) fails under redis storeMode', async () => {
      let callCount = 0;
      const failingRedis: RedisClient = {
        async get() {
          return null;
        },
        async set() {
          throw new Error('READONLY');
        },
        async del() {
          return 0;
        },
      };

      await app.register(idempotencyPlugin, { storeMode: 'redis', redis: failingRedis });
      app.post('/test', async () => {
        callCount++;
        return { result: 'created' };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'lock-fail-key' },
        payload: { name: 'test' },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe('IDEMPOTENCY_STORE_UNAVAILABLE');
      expect(callCount).toBe(0);
    });

    it('does not return bare 2xx when Redis save fails after mutation; leaves marker so retry does not re-execute', async () => {
      let callCount = 0;
      const store = new Map<string, string>();
      let cacheWriteAttempts = 0;

      const flakyRedis: RedisClient = {
        async get(key: string) {
          return store.get(key) ?? null;
        },
        async set(key: string, value: string, ...args: unknown[]) {
          // Allow lock acquires; fail the first durable response/body write, then allow marker.
          if (key.endsWith(':lock')) {
            if (args.includes('NX') && store.has(key)) return null;
            store.set(key, value);
            return 'OK';
          }
          cacheWriteAttempts += 1;
          if (cacheWriteAttempts === 1) {
            throw new Error('REDIS_WRITE_FAILED');
          }
          store.set(key, value);
          return 'OK';
        },
        async del(key: string | string[]) {
          const keys = Array.isArray(key) ? key : [key];
          let n = 0;
          for (const k of keys) {
            if (store.delete(k)) n += 1;
          }
          return n;
        },
      };

      await app.register(idempotencyPlugin, { storeMode: 'redis', redis: flakyRedis });
      app.post('/test', async (_req, reply) => {
        callCount += 1;
        return reply.status(201).send({ result: 'created', id: 'dup-risk' });
      });

      const first = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'post-mutation-save-fail' },
        payload: { name: 'test' },
      });

      expect(first.statusCode).toBe(503);
      expect(first.json().code).toBe('IDEMPOTENCY_REPLAY_PENDING');
      expect(first.headers['x-idempotency-replay']).toBe('pending');
      expect(callCount).toBe(1);

      const cached = store.get('idempotency:global:anon:post-mutation-save-fail');
      expect(cached).toBeTruthy();
      expect(JSON.parse(cached!).status).toBe('completed_without_body');

      const retry = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'post-mutation-save-fail' },
        payload: { name: 'test' },
      });

      expect(retry.statusCode).toBe(503);
      expect(retry.json().code).toBe('IDEMPOTENCY_REPLAY_PENDING');
      expect(retry.headers['x-idempotency-replay']).toBe('pending');
      expect(callCount).toBe(1); // must not re-execute mutation
    });

    it('returns 503 without re-executing when both response and marker Redis writes fail after mutation', async () => {
      let callCount = 0;
      const store = new Map<string, string>();

      const flakyRedis: RedisClient = {
        async get(key: string) {
          return store.get(key) ?? null;
        },
        async set(key: string, value: string, ...args: unknown[]) {
          if (key.endsWith(':lock')) {
            if (args.includes('NX') && store.has(key)) return null;
            store.set(key, value);
            return 'OK';
          }
          throw new Error('REDIS_DOWN');
        },
        async del(key: string | string[]) {
          const keys = Array.isArray(key) ? key : [key];
          let n = 0;
          for (const k of keys) {
            if (store.delete(k)) n += 1;
          }
          return n;
        },
      };

      await app.register(idempotencyPlugin, { storeMode: 'redis', redis: flakyRedis });
      app.post('/test', async () => {
        callCount += 1;
        return { result: 'created' };
      });

      const first = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'total-write-fail' },
        payload: { name: 'test' },
      });

      expect(first.statusCode).toBe(503);
      expect(first.json().code).toBe('IDEMPOTENCY_REPLAY_PENDING');
      expect(first.headers['x-idempotency-replay']).toBe('unsaved');
      expect(callCount).toBe(1);
      // Lock retained so concurrent/retry hits conflict instead of re-mutating.
      expect(store.get('idempotency:global:anon:total-write-fail:lock')).toBeTruthy();

      const retry = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'total-write-fail' },
        payload: { name: 'test' },
      });

      expect(retry.statusCode).toBe(409);
      expect(retry.json().code).toBe('IDEMPOTENCY_CONFLICT');
      expect(callCount).toBe(1);
    });

    it('still returns cached 2xx on happy-path replay when Redis save succeeds', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { storeMode: 'redis', redis });
      app.post('/test', async (_req, reply) => {
        callCount += 1;
        return reply.status(201).send({ result: 'created', id: 'ok' });
      });

      const first = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'happy-replay' },
        payload: { name: 'test' },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'happy-replay' },
        payload: { name: 'test' },
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.headers['x-idempotency-replay']).toBe('true');
      expect(second.json()).toEqual({ result: 'created', id: 'ok' });
      expect(callCount).toBe(1);
    });
  });

  describe('custom header name', () => {
    it('should support custom header name', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis, headerName: 'x-idempotency-key' });
      app.post('/test', async () => {
        callCount++;
        return { result: 'created' };
      });

      await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'x-idempotency-key': 'custom-header-key' },
        payload: { name: 'test' },
      });

      await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'x-idempotency-key': 'custom-header-key' },
        payload: { name: 'test' },
      });

      expect(callCount).toBe(1); // Only first executed
    });
  });

  describe('different keys for different operations', () => {
    it('should treat different idempotency keys independently', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis });
      app.post('/test', async () => {
        callCount++;
        return { result: 'created', count: callCount };
      });

      const response1 = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'key-a' },
        payload: { name: 'a' },
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'key-b' },
        payload: { name: 'b' },
      });

      expect(response1.json().count).toBe(1);
      expect(response2.json().count).toBe(2);
      expect(callCount).toBe(2); // Both executed (different keys)
    });
  });
});

describe('idempotency scoping, atomic lock and cacheability (PRC-M010/M019/M020)', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app.close();
  });

  /** Simulates gateway auth + tenant + RBAC onRequest gates ahead of the plugin. */
  async function build(
    opts: { requireScope?: boolean; denied?: Set<string>; lockTtlSeconds?: number } = {},
  ) {
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request, reply) => {
      const sub = request.headers['x-test-user'] as string | undefined;
      if (sub) {
        (request as unknown as { user: { sub: string } }).user = { sub };
        (request as unknown as { tenantId: string }).tenantId = 'tenant-1';
      }
      if (sub && opts.denied?.has(sub)) {
        return reply.status(403).send({ code: 'FORBIDDEN' });
      }
    });
    await app.register(idempotencyPlugin, {
      storeMode: 'memory',
      redis: new InMemoryIdempotencyStore(),
      ...(opts.requireScope !== undefined ? { requireScope: opts.requireScope } : {}),
      ...(opts.lockTtlSeconds ? { lockTtlSeconds: opts.lockTtlSeconds } : {}),
    });
  }
  const post = (user: string | undefined, key: string, payload: unknown, url = '/things') =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'idempotency-key': key, ...(user ? { 'x-test-user': user } : {}) },
      payload: payload as Record<string, unknown>,
    });

  it('user B replaying user A key gets a fresh execution, never A body (M010)', async () => {
    await build({ requireScope: true });
    let n = 0;
    app.post('/things', async (req) => ({ id: ++n, by: (req as unknown as { user: { sub: string } }).user.sub }));
    expect((await post('alice', 'k1', { a: 1 })).json()).toEqual({ id: 1, by: 'alice' });
    const b = await post('bob', 'k1', { a: 1 });
    expect(b.json()).toEqual({ id: 2, by: 'bob' });
    expect(b.headers['x-idempotency-replay']).toBeUndefined();
  });

  it('same key with a different path or body returns 422 IDEMPOTENCY_KEY_REUSED (M010)', async () => {
    await build({ requireScope: true });
    let n = 0;
    app.post('/things', async () => ({ id: ++n }));
    app.post('/other', async () => ({ id: ++n }));
    expect((await post('alice', 'k2', { a: 1 })).statusCode).toBe(200);
    const diffBody = await post('alice', 'k2', { a: 2 });
    expect(diffBody.statusCode).toBe(422);
    expect(diffBody.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await post('alice', 'k2', { a: 1 }, '/other')).statusCode).toBe(422);
    // The identical request still replays.
    const same = await post('alice', 'k2', { a: 1 });
    expect(same.headers['x-idempotency-replay']).toBe('true');
    expect(n).toBe(1);
  });

  it('a caller the RBAC gate rejects gets 403, not the cached body (M010)', async () => {
    const denied = new Set<string>();
    await build({ requireScope: true, denied });
    app.post('/things', async () => ({ secret: 'payload' }));
    expect((await post('alice', 'k3', {})).statusCode).toBe(200);
    denied.add('alice');
    const replay = await post('alice', 'k3', {});
    expect(replay.statusCode).toBe(403);
    expect(replay.body).not.toContain('payload');
  });

  it('requireScope skips idempotency for requests with no tenant/principal (M010)', async () => {
    await build({ requireScope: true });
    let n = 0;
    app.post('/things', async () => ({ id: ++n }));
    await post(undefined, 'anon', {});
    const second = await post(undefined, 'anon', {});
    expect(second.headers['x-idempotency-replay']).toBeUndefined();
    expect(n).toBe(2);
  });

  it('20 concurrent POSTs with the same key run the handler exactly once (M019)', async () => {
    await build({ requireScope: true });
    let n = 0;
    app.post('/things', async () => {
      n += 1;
      await new Promise((r) => setTimeout(r, 25));
      return { id: n };
    });
    const results = await Promise.all(Array.from({ length: 20 }, () => post('alice', 'k4', { x: 1 })));
    expect(n).toBe(1);
    for (const r of results) expect([200, 409]).toContain(r.statusCode);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
  });

  it('in-memory store implements SET NX', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.set('a', '1', 'EX', 60, 'NX')).toBe('OK');
    expect(await store.set('a', '2', 'EX', 60, 'NX')).toBeNull();
    expect(await store.get('a')).toBe('1');
  });

  it('refreshes the lock while a slow handler runs (M019)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await build({ requireScope: true, lockTtlSeconds: 2 });
      let n = 0;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      app.post('/things', async () => {
        n += 1;
        await gate;
        return { id: n };
      });
      const first = post('alice', 'k5', {});
      await vi.advanceTimersByTimeAsync(5000); // > lock TTL
      const dup = await post('alice', 'k5', {});
      expect(dup.statusCode).toBe(409);
      release();
      expect((await first).statusCode).toBe(200);
      expect(n).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('429 is not cached: retry after the window executes the handler (M020)', async () => {
    await build({ requireScope: true });
    let n = 0;
    app.post('/things', async (_req, reply) => {
      n += 1;
      if (n === 1) return reply.status(429).send({ code: 'RATE_LIMITED' });
      return reply.status(201).send({ ok: true });
    });
    expect((await post('alice', 'k6', {})).statusCode).toBe(429);
    const retry = await post('alice', 'k6', {});
    expect(retry.statusCode).toBe(201);
    expect(n).toBe(2);
  });

  it('403 is not cached: after a role grant the same key succeeds (M020)', async () => {
    await build({ requireScope: true });
    let granted = false;
    app.post('/things', async (_req, reply) =>
      granted ? reply.status(201).send({ ok: true }) : reply.status(403).send({ code: 'FORBIDDEN' }),
    );
    expect((await post('alice', 'k7', {})).statusCode).toBe(403);
    granted = true;
    expect((await post('alice', 'k7', {})).statusCode).toBe(201);
  });

  it('classifies cacheable statuses (M020)', () => {
    for (const code of [200, 201, 204, 400, 404, 409, 422]) {
      expect(isCacheableIdempotentStatus(code)).toBe(true);
    }
    for (const code of [401, 403, 408, 423, 429, 500, 503]) {
      expect(isCacheableIdempotentStatus(code)).toBe(false);
    }
  });
});
