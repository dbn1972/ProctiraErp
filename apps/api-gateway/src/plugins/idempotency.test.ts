import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import idempotencyPlugin, { type RedisClient } from './idempotency.js';

/**
 * In-memory Redis mock for testing the idempotency plugin.
 */
function createMockRedis(): RedisClient & { store: Map<string, { value: string; expiresAt?: number }> } {
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
      const lockKey = `idempotency:${tenantId}:${key}:lock`;
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
      const lockKey = 'idempotency:global:throw-key-1:lock';
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

  describe('graceful degradation', () => {
    it('should not enforce idempotency when no Redis client is provided', async () => {
      let callCount = 0;
      await app.register(idempotencyPlugin, { redis: undefined });
      app.post('/test', async () => {
        callCount++;
        return { result: 'created' };
      });

      await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'no-redis-key' },
        payload: { name: 'test' },
      });

      await app.inject({
        method: 'POST',
        url: '/test',
        headers: { 'idempotency-key': 'no-redis-key' },
        payload: { name: 'test' },
      });

      expect(callCount).toBe(2); // Both executed (no Redis)
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
