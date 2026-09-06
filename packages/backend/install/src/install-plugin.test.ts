/**
 * Integration tests for the Install Plugin - Fastify routes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { installPlugin } from './install-plugin';

describe('installPlugin (Fastify routes)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(installPlugin, {
      loggerName: 'install-test',
      connectivityTester: {
        testCdn: async () => ({ healthy: true, latencyMs: 5 }),
        testDatabase: async () => ({ healthy: true, latencyMs: 10 }),
        testStorage: async () => ({ healthy: true, latencyMs: 8 }),
        testCache: async () => ({ healthy: true, latencyMs: 2 }),
        testQueue: async () => ({ healthy: true, latencyMs: 12 }),
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /install/status', () => {
    it('should return initial bootstrap status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/install/status',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.isComplete).toBe(false);
      expect(body.pendingSteps).toEqual(['cdn', 'database', 'storage', 'cache', 'queue']);
      expect(body.completedSteps).toEqual([]);
    });
  });

  describe('POST /install/configure/cdn', () => {
    it('should configure CDN with valid config', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: {
          adapter: 'nginx',
          baseUrl: 'https://cdn.example.com',
          tenantAware: true,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.step).toBe('cdn');
    });

    it('should return 400 for invalid config', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: {
          adapter: 'nginx',
          baseUrl: '',
          tenantAware: true,
        },
      });

      // Typebox schema validation will reject empty baseUrl (minLength: 1)
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /install/configure/database', () => {
    it('should configure database after CDN', async () => {
      // First configure CDN
      await app.inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: {
          adapter: 'nginx',
          baseUrl: 'https://cdn.example.com',
          tenantAware: true,
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/install/configure/database',
        payload: {
          provider: 'postgresql',
          host: 'localhost',
          port: 5432,
          database: 'proctira',
          username: 'admin',
          password: 'secret',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.step).toBe('database');
    });

    it('should return 400 when CDN not configured first', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/install/configure/database',
        payload: {
          provider: 'postgresql',
          host: 'localhost',
          port: 5432,
          database: 'proctira',
          username: 'admin',
          password: 'secret',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('cdn');
    });
  });

  describe('POST /install/finalize', () => {
    it('should finalize after all steps are configured', async () => {
      // Configure all steps in order
      await app.inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/database',
        payload: { provider: 'postgresql', host: 'localhost', port: 5432, database: 'proctira', username: 'admin', password: 'secret' },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/storage',
        payload: { adapter: 'minio', bucket: 'files', endpoint: 'http://localhost:9000', accessKeyId: 'admin', secretAccessKey: 'secret' },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/cache',
        payload: { adapter: 'redis', host: 'localhost', port: 6379 },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/queue',
        payload: { backend: 'rabbitmq', rabbitmq: { url: 'amqp://localhost:5672', exchange: 'proctira' } },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/install/finalize',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.runId).toBeDefined();
      expect(body.completedAt).toBeDefined();
    });

    it('should return 400 when steps are missing', async () => {
      await app.inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/install/finalize',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('missing steps');
    });

    it('should return 409 when configure/finalize is attempted after lock', async () => {
      await app.inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/database',
        payload: {
          provider: 'postgresql',
          host: 'localhost',
          port: 5432,
          database: 'proctira',
          username: 'admin',
          password: 'secret',
        },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/storage',
        payload: {
          adapter: 'minio',
          bucket: 'files',
          endpoint: 'http://localhost:9000',
          accessKeyId: 'admin',
          secretAccessKey: 'secret',
        },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/cache',
        payload: { adapter: 'redis', host: 'localhost', port: 6379 },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/queue',
        payload: {
          backend: 'rabbitmq',
          rabbitmq: { url: 'amqp://localhost:5672', exchange: 'proctira' },
        },
      });
      const finalized = await app.inject({ method: 'POST', url: '/install/finalize' });
      expect(finalized.statusCode).toBe(200);

      const lockedConfigure = await app.inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });
      expect(lockedConfigure.statusCode).toBe(409);
      expect(lockedConfigure.json().error).toMatch(/already finalized|locked/i);

      const lockedFinalize = await app.inject({ method: 'POST', url: '/install/finalize' });
      expect(lockedFinalize.statusCode).toBe(409);
    });
  });

  describe('install token gate', () => {
    let secured: FastifyInstance;

    beforeEach(async () => {
      secured = Fastify();
      await secured.register(installPlugin, {
        loggerName: 'install-token-test',
        installToken: 'test-install-secret',
        connectivityTester: {
          testCdn: async () => ({ healthy: true, latencyMs: 5 }),
          testDatabase: async () => ({ healthy: true, latencyMs: 10 }),
          testStorage: async () => ({ healthy: true, latencyMs: 8 }),
          testCache: async () => ({ healthy: true, latencyMs: 2 }),
          testQueue: async () => ({ healthy: true, latencyMs: 12 }),
        },
      });
      await secured.ready();
    });

    afterEach(async () => {
      await secured.close();
    });

    it('rejects mutate without token', async () => {
      const response = await secured.inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });
      expect(response.statusCode).toBe(401);
    });

    it('allows mutate with matching X-Install-Token', async () => {
      const response = await secured.inject({
        method: 'POST',
        url: '/install/configure/cdn',
        headers: { 'x-install-token': 'test-install-secret' },
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('still allows public status without token', async () => {
      const response = await secured.inject({ method: 'GET', url: '/install/status' });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /install/health', () => {
    it('should return unhealthy when no adapters configured', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/install/health',
      });

      expect(response.statusCode).toBe(503);
      const body = response.json();
      expect(body.status).toBe('unhealthy');
    });

    it('should return healthy after all adapters configured', async () => {
      await app.inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/database',
        payload: { provider: 'postgresql', host: 'localhost', port: 5432, database: 'proctira', username: 'admin', password: 'secret' },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/storage',
        payload: { adapter: 'minio', bucket: 'files', endpoint: 'http://localhost:9000', accessKeyId: 'admin', secretAccessKey: 'secret' },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/cache',
        payload: { adapter: 'redis', host: 'localhost', port: 6379 },
      });
      await app.inject({
        method: 'POST',
        url: '/install/configure/queue',
        payload: { backend: 'rabbitmq', rabbitmq: { url: 'amqp://localhost:5672', exchange: 'proctira' } },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/install/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('healthy');
    });
  });
});
