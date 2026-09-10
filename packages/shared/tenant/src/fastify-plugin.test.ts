import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { tenantPlugin } from './fastify-plugin.js';

describe('tenantPlugin', () => {
  let app: FastifyInstance;
  let mockExecuteRawUnsafe: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    app = Fastify();
    mockExecuteRawUnsafe = vi.fn().mockResolvedValue(undefined);
  });

  it('should resolve tenant from X-Tenant-ID header and set session variable', async () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';

    await app.register(tenantPlugin, {
      getDbClient: () => ({ $executeRawUnsafe: mockExecuteRawUnsafe }),
    });

    app.get('/test', async (request) => {
      return { tenantId: request.tenantId ?? null, source: request.tenantSource ?? null };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-tenant-id': tenantId },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.tenantId).toBe(tenantId);
    expect(body.source).toBe('header');

    // Verify PostgreSQL session variable was set via a bound parameter (G-720)
    expect(mockExecuteRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.current_tenant_id', $1, true)"),
      tenantId,
    );
  });

  it('should resolve tenant from JWT claim (user object)', async () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';

    // Register a hook BEFORE the tenant plugin to simulate auth setting user
    app.addHook('onRequest', async (request) => {
      (request as unknown as { user: Record<string, unknown> }).user = {
        tenantId,
        sub: 'user-123',
      };
    });

    await app.register(tenantPlugin, {
      getDbClient: () => ({ $executeRawUnsafe: mockExecuteRawUnsafe }),
    });

    app.get('/test', async (request) => {
      return { tenantId: request.tenantId ?? null, source: request.tenantSource ?? null };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.tenantId).toBe(tenantId);
    expect(body.source).toBe('jwt');
  });

  it('should skip excluded paths', async () => {
    await app.register(tenantPlugin, {
      excludePaths: ['/health', '/api/v1/public/*'],
      getDbClient: () => ({ $executeRawUnsafe: mockExecuteRawUnsafe }),
    });

    app.get('/health', async () => {
      return { status: 'ok' };
    });

    app.get('/api/v1/public/info', async () => {
      return { info: 'public' };
    });

    // Health endpoint should work without tenant
    const healthResponse = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(healthResponse.statusCode).toBe(200);

    // Public endpoint should work without tenant
    const publicResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/public/info',
    });
    expect(publicResponse.statusCode).toBe(200);
  });

  it('should return 401 when tenant cannot be resolved', async () => {
    await app.register(tenantPlugin, {
      getDbClient: () => ({ $executeRawUnsafe: mockExecuteRawUnsafe }),
    });

    app.get('/test', async (request) => {
      return { tenantId: request.tenantId ?? null };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { host: 'localhost:3000' },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('TENANT_RESOLUTION_FAILED');
  });

  it('should return 401 for invalid UUID in header', async () => {
    await app.register(tenantPlugin, {
      getDbClient: () => ({ $executeRawUnsafe: mockExecuteRawUnsafe }),
    });

    app.get('/test', async (request) => {
      return { tenantId: request.tenantId ?? null };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-tenant-id': 'not-a-valid-uuid' },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('TENANT_RESOLUTION_FAILED');
  });

  it('should resolve tenant from subdomain', async () => {
    await app.register(tenantPlugin, {
      baseDomain: 'proctira.org',
      resolveSlugToId: false, // Don't look up in DB for this test
      getDbClient: () => ({ $executeRawUnsafe: mockExecuteRawUnsafe }),
    });

    app.get('/test', async (request) => {
      return { tenantId: request.tenantId ?? null, source: request.tenantSource ?? null };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { host: 'ministry-edu.proctira.org' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.tenantId).toBe('ministry-edu');
    expect(body.source).toBe('subdomain');
  });

  it('should not set session variable when no DB client available', async () => {
    // Create app without any DB client
    const appNoPrisma = Fastify();
    await appNoPrisma.register(tenantPlugin, {});

    appNoPrisma.get('/test', async (request) => {
      return { tenantId: request.tenantId ?? null };
    });

    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const response = await appNoPrisma.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-tenant-id': tenantId },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.tenantId).toBe(tenantId);
  });

  it('should use custom getDbClient function', async () => {
    const customExecute = vi.fn().mockResolvedValue(undefined);

    await app.register(tenantPlugin, {
      getDbClient: () => ({ $executeRawUnsafe: customExecute }),
    });

    app.get('/test', async (request) => {
      return { tenantId: request.tenantId ?? null };
    });

    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-tenant-id': tenantId },
    });

    expect(customExecute).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.current_tenant_id', $1, true)"),
      tenantId,
    );
  });
});

describe('G-720 — tenant GUC is bound, never interpolated', () => {
  it('passes a tenant id containing a quote as a parameter, not SQL text', async () => {
    const execute = vi.fn().mockResolvedValue(1);
    const app = Fastify();
    await app.register(tenantPlugin, {
      baseDomain: 'proctira.org',
      getDbClient: () => ({ $executeRawUnsafe: execute }),
      resolveSlugToId: false,
      // UUID validation normally rejects this header up-front; disable it so the
      // test exercises the SQL binding path itself.
      requireUuid: false,
    });
    app.get('/test', async (request) => ({ tenantId: request.tenantId }));

    const hostile = "abc'); DROP TABLE students; --";
    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-tenant-id': hostile },
    });
    expect(response.statusCode).toBe(200);
    const [sql, param] = execute.mock.calls[0] as [string, string];
    expect(sql).not.toContain(hostile);
    expect(param).toBe(hostile);
    await app.close();
  });
});
