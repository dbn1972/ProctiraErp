/**
 * PRC-L568 — install HTTP surface: adapter endpoints are SSRF-restricted and connectivity
 * failures are contained.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryBootstrapStore } from './bootstrap-store';
import { installPlugin } from './install-plugin';
import { InstallServiceImpl } from './install-service';

const TOKEN = 'ssrf-test-install-token-000';
const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/** name -> addresses; anything unknown fails to resolve. */
function resolverFor(table: Record<string, string[]>) {
  return async (host: string) => {
    const addresses = table[host];
    if (!addresses) throw new Error(`ENOTFOUND ${host}`);
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
}

const DNS = resolverFor({
  'cdn.example.com': ['93.184.216.34'],
  'minio.example.com': ['93.184.216.35'],
  'mq.example.com': ['93.184.216.36'],
  'internal.example.com': ['10.0.4.12'],
  'minio.corp.internal': ['10.0.4.20'],
  'metadata.example.com': ['169.254.169.254'],
  'loop.example.com': ['127.0.0.1'],
  'mixed.example.com': ['93.184.216.40', '192.168.1.5'],
});

async function buildApp(allowed?: string[]): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(installPlugin, {
    loggerName: 'install-ssrf-test',
    installToken: TOKEN,
    resolveHost: DNS,
    endpointAllowedHosts: allowed,
  });
  await app.ready();
  return app;
}

function configureCdn(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/install/configure/cdn',
    headers: { 'x-install-token': TOKEN },
    payload: { adapter: 'custom', tenantAware: true, ...payload },
  });
}

describe('PRC-L568: install endpoint SSRF policy', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each([
    ['http scheme', 'http://cdn.example.com'],
    ['file scheme', 'file:///etc/passwd'],
    ['metadata IP literal', 'https://169.254.169.254/latest/meta-data'],
    ['loopback IP literal', 'https://127.0.0.1:8443'],
    ['IPv6 loopback literal', 'https://[::1]/'],
    ['private IP literal', 'https://10.0.0.5/'],
    ['name resolving to metadata', 'https://metadata.example.com/'],
    ['name resolving to loopback', 'https://loop.example.com/'],
    ['name resolving to a private range', 'https://internal.example.com/'],
    ['name with one private address', 'https://mixed.example.com/'],
    ['unresolvable name', 'https://nowhere.example.com/'],
  ])('rejects a CDN baseUrl with %s', async (_label, baseUrl) => {
    app = await buildApp();
    const response = await configureCdn(app, { baseUrl });
    expect(response.statusCode).toBe(400);
    expect(response.json().success).toBe(false);
  });

  it('rejects a private invalidation endpoint even when the base URL is public', async () => {
    app = await buildApp();
    const response = await configureCdn(app, {
      baseUrl: 'https://cdn.example.com',
      custom: { invalidationEndpoint: 'https://169.254.169.254/purge' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('accepts a public https CDN', async () => {
    app = await buildApp();
    const response = await configureCdn(app, { baseUrl: 'https://cdn.example.com' });
    expect(response.statusCode).toBe(200);
  });

  it('an explicitly allow-listed private host is accepted; metadata stays blocked', async () => {
    app = await buildApp(['internal.example.com', 'metadata.example.com']);
    expect((await configureCdn(app, { baseUrl: 'https://internal.example.com' })).statusCode).toBe(
      200,
    );
    await app.close();
    app = await buildApp(['metadata.example.com']);
    expect((await configureCdn(app, { baseUrl: 'https://metadata.example.com' })).statusCode).toBe(
      400,
    );
  });

  it('refuses a wildcard allow-list entry at registration', async () => {
    const bad = Fastify();
    await expect(
      (async () => {
        await bad.register(installPlugin, {
          loggerName: 'install-ssrf-wildcard',
          installToken: TOKEN,
          resolveHost: DNS,
          endpointAllowedHosts: ['*.example.com'],
        });
        await bad.ready();
      })(),
    ).rejects.toThrow(/wildcard/i);
    await bad.close().catch(() => undefined);
  });

  it('storage endpoint and RabbitMQ URL are policed too (plaintext / private refused)', async () => {
    app = await buildApp();
    const headers = { 'x-install-token': TOKEN };
    expect((await configureCdn(app, { baseUrl: 'https://cdn.example.com' })).statusCode).toBe(200);
    const db = await app.inject({
      method: 'POST',
      url: '/install/configure/database',
      headers,
      payload: {
        provider: 'postgresql',
        host: 'db',
        port: 5432,
        database: 'proctira',
        username: 'admin',
        password: 'secret',
      },
    });
    expect(db.statusCode).toBe(200);
    const storageHttp = await app.inject({
      method: 'POST',
      url: '/install/configure/storage',
      headers,
      payload: {
        adapter: 'minio',
        bucket: 'files',
        endpoint: 'http://minio.example.com',
        accessKeyId: 'a',
        secretAccessKey: 'b',
      },
    });
    expect(storageHttp.statusCode).toBe(400);
    const storagePrivate = await app.inject({
      method: 'POST',
      url: '/install/configure/storage',
      headers,
      payload: {
        adapter: 'minio',
        bucket: 'files',
        endpoint: 'https://minio.corp.internal',
        accessKeyId: 'a',
        secretAccessKey: 'b',
      },
    });
    expect(storagePrivate.statusCode).toBe(400);
    const storageOk = await app.inject({
      method: 'POST',
      url: '/install/configure/storage',
      headers,
      payload: {
        adapter: 'minio',
        bucket: 'files',
        endpoint: 'https://minio.example.com',
        accessKeyId: 'a',
        secretAccessKey: 'b',
      },
    });
    expect(storageOk.statusCode).toBe(200);
    const cache = await app.inject({
      method: 'POST',
      url: '/install/configure/cache',
      headers,
      payload: { adapter: 'redis', host: 'cache', port: 6379 },
    });
    expect(cache.statusCode).toBe(200);
    const mqPlain = await app.inject({
      method: 'POST',
      url: '/install/configure/queue',
      headers,
      payload: { backend: 'rabbitmq', rabbitmq: { url: 'amqp://mq.example.com', exchange: 'x' } },
    });
    expect(mqPlain.statusCode).toBe(400);
    const mqTls = await app.inject({
      method: 'POST',
      url: '/install/configure/queue',
      headers,
      payload: { backend: 'rabbitmq', rabbitmq: { url: 'amqps://mq.example.com', exchange: 'x' } },
    });
    expect(mqTls.statusCode).toBe(200);
  });
});

describe('PRC-L568: connectivity failures are contained', () => {
  it('a throwing connectivity tester yields a failed step, not an exception', async () => {
    const service = new InstallServiceImpl({
      logger: silentLogger,
      store: new InMemoryBootstrapStore(),
      connectivityTester: {
        testCdn: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    });
    const result = await service.configureCDN({
      adapter: 'nginx',
      baseUrl: 'https://cdn.example.com',
      tenantAware: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it('a hanging connectivity tester times out', async () => {
    const service = new InstallServiceImpl({
      logger: silentLogger,
      store: new InMemoryBootstrapStore(),
      connectivityTimeoutMs: 50,
      connectivityTester: {
        testCdn: () => new Promise(() => undefined),
      },
    });
    const result = await service.configureCDN({
      adapter: 'nginx',
      baseUrl: 'https://cdn.example.com',
      tenantAware: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });
});
