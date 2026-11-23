/**
 * Integration tests for the Install Plugin - Fastify routes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { installPlugin } from './install-plugin';

const TEST_INSTALL_TOKEN = 'test-install-token-0123456789';
/** PRC-L568: deterministic public resolution so the suite never depends on live DNS. */
const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

describe('installPlugin (Fastify routes)', () => {
  let app: FastifyInstance;
  /** Every install route requires the token (PRC-M625); the happy-path suite always sends it. */
  const inject = (opts: InjectOptions) =>
    app.inject({
      ...opts,
      headers: { 'x-install-token': TEST_INSTALL_TOKEN, ...(opts.headers ?? {}) },
    });

  beforeEach(async () => {
    app = Fastify();
    await app.register(installPlugin, {
      loggerName: 'install-test',
      installToken: TEST_INSTALL_TOKEN,
      resolveHost: publicResolver,
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
      const response = await inject({
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
      const response = await inject({
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
      const response = await inject({
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
      await inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: {
          adapter: 'nginx',
          baseUrl: 'https://cdn.example.com',
          tenantAware: true,
        },
      });

      const response = await inject({
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
      const response = await inject({
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
      await inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });
      await inject({
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
      await inject({
        method: 'POST',
        url: '/install/configure/storage',
        payload: {
          adapter: 'minio',
          bucket: 'files',
          endpoint: 'https://minio.example.com',
          accessKeyId: 'admin',
          secretAccessKey: 'secret',
        },
      });
      await inject({
        method: 'POST',
        url: '/install/configure/cache',
        payload: { adapter: 'redis', host: 'localhost', port: 6379 },
      });
      await inject({
        method: 'POST',
        url: '/install/configure/queue',
        payload: {
          backend: 'rabbitmq',
          rabbitmq: { url: 'amqps://mq.example.com:5671', exchange: 'proctira' },
        },
      });

      const response = await inject({
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
      await inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });

      const response = await inject({
        method: 'POST',
        url: '/install/finalize',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('missing steps');
    });

    it('should return 409 when configure/finalize is attempted after lock', async () => {
      await inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });
      await inject({
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
      await inject({
        method: 'POST',
        url: '/install/configure/storage',
        payload: {
          adapter: 'minio',
          bucket: 'files',
          endpoint: 'https://minio.example.com',
          accessKeyId: 'admin',
          secretAccessKey: 'secret',
        },
      });
      await inject({
        method: 'POST',
        url: '/install/configure/cache',
        payload: { adapter: 'redis', host: 'localhost', port: 6379 },
      });
      await inject({
        method: 'POST',
        url: '/install/configure/queue',
        payload: {
          backend: 'rabbitmq',
          rabbitmq: { url: 'amqps://mq.example.com:5671', exchange: 'proctira' },
        },
      });
      const finalized = await inject({ method: 'POST', url: '/install/finalize' });
      expect(finalized.statusCode).toBe(200);

      const lockedConfigure = await inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });
      expect(lockedConfigure.statusCode).toBe(409);
      expect(lockedConfigure.json().error).toMatch(/already finalized|locked/i);

      const lockedFinalize = await inject({ method: 'POST', url: '/install/finalize' });
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
        resolveHost: publicResolver,
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

    it('PRC-M625: status and health are gated too (401 without token)', async () => {
      for (const url of ['/install/status', '/install/health']) {
        const response = await secured.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(401);
      }
      const ok = await secured.inject({
        method: 'GET',
        url: '/install/status',
        headers: { 'x-install-token': 'test-install-secret' },
      });
      expect(ok.statusCode).toBe(200);
    });

    it('PRC-M625: a wrong token of the same length is rejected', async () => {
      const response = await secured.inject({
        method: 'POST',
        url: '/install/finalize',
        headers: { 'x-install-token': 'test-install-secreX' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('PRC-M625: repeated failures from one client are throttled (429), even with the right token', async () => {
      for (let i = 0; i < 10; i += 1) {
        const bad = await secured.inject({
          method: 'GET',
          url: '/install/status',
          headers: { 'x-install-token': `wrong-${i}` },
        });
        expect(bad.statusCode).toBe(401);
      }
      const blocked = await secured.inject({
        method: 'GET',
        url: '/install/status',
        headers: { 'x-install-token': 'test-install-secret' },
      });
      expect(blocked.statusCode).toBe(429);
    });
  });

  describe('PRC-M625: token gate is on by default', () => {
    const saved = process.env.INSTALL_TOKEN;
    afterEach(() => {
      if (saved === undefined) delete process.env.INSTALL_TOKEN;
      else process.env.INSTALL_TOKEN = saved;
    });

    it('refuses to register without a token (no option, no INSTALL_TOKEN)', async () => {
      delete process.env.INSTALL_TOKEN;
      const bare = Fastify();
      await expect(
        (async () => {
          await bare.register(installPlugin, { loggerName: 'install-no-token' });
          await bare.ready();
        })(),
      ).rejects.toThrow(/no install token configured/i);
      await bare.close().catch(() => undefined);
    });

    it('refuses a short token', async () => {
      delete process.env.INSTALL_TOKEN;
      const bare = Fastify();
      await expect(
        (async () => {
          await bare.register(installPlugin, {
            loggerName: 'install-short',
            installToken: 'short',
          });
          await bare.ready();
        })(),
      ).rejects.toThrow(/at least 16 characters/i);
      await bare.close().catch(() => undefined);
    });

    it('uses INSTALL_TOKEN from the environment', async () => {
      process.env.INSTALL_TOKEN = 'env-install-token-abcdef';
      const envApp = Fastify();
      await envApp.register(installPlugin, { loggerName: 'install-env' });
      await envApp.ready();
      const denied = await envApp.inject({ method: 'GET', url: '/install/status' });
      expect(denied.statusCode).toBe(401);
      const allowed = await envApp.inject({
        method: 'GET',
        url: '/install/status',
        headers: { 'x-install-token': 'env-install-token-abcdef' },
      });
      expect(allowed.statusCode).toBe(200);
      await envApp.close();
    });
  });

  describe('GET /install/health', () => {
    it('should return unhealthy when no adapters configured', async () => {
      const response = await inject({
        method: 'GET',
        url: '/install/health',
      });

      expect(response.statusCode).toBe(503);
      const body = response.json();
      expect(body.status).toBe('unhealthy');
    });

    it('should return healthy after all adapters configured', async () => {
      await inject({
        method: 'POST',
        url: '/install/configure/cdn',
        payload: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
      });
      await inject({
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
      await inject({
        method: 'POST',
        url: '/install/configure/storage',
        payload: {
          adapter: 'minio',
          bucket: 'files',
          endpoint: 'https://minio.example.com',
          accessKeyId: 'admin',
          secretAccessKey: 'secret',
        },
      });
      await inject({
        method: 'POST',
        url: '/install/configure/cache',
        payload: { adapter: 'redis', host: 'localhost', port: 6379 },
      });
      await inject({
        method: 'POST',
        url: '/install/configure/queue',
        payload: {
          backend: 'rabbitmq',
          rabbitmq: { url: 'amqps://mq.example.com:5671', exchange: 'proctira' },
        },
      });

      const response = await inject({
        method: 'GET',
        url: '/install/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('healthy');
    });
  });
});
