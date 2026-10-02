/**
 * PRC-L104: the gateway hands the examination plugin a per-tenant timezone resolver (tenant
 * settings first, then the tenants row), instead of letting exam date rules default to UTC.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTenantTimeZoneResolver, type TenantTimeZoneSources } from './tenant-timezone.js';

const captured = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));
vi.mock('@proctira/backend-examination', async (orig) => {
  const mod = await orig<typeof import('@proctira/backend-examination')>();
  const wrapped: FastifyPluginAsync<Record<string, unknown>> = async (fastify, options) => {
    captured.options = options;
    await fastify.register(mod.examinationPlugin, options as never);
  };
  // Same (non-encapsulated) registration semantics as the real fastify-plugin wrapper.
  (wrapped as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
  return { ...mod, examinationPlugin: wrapped };
});

function sources(overrides: Partial<TenantTimeZoneSources> = {}): TenantTimeZoneSources {
  return {
    settingsTimezone: async () => null,
    tenantRow: async () => null,
    ...overrides,
  };
}

describe('PRC-L104 createTenantTimeZoneResolver', () => {
  it('prefers the admin tenant-settings timezone over the tenants row', async () => {
    const resolve = createTenantTimeZoneResolver({
      sources: sources({
        settingsTimezone: async () => 'Asia/Kolkata',
        tenantRow: async () => ({ timezone: 'UTC' }),
      }),
    });
    await expect(resolve('t1')).resolves.toBe('Asia/Kolkata');
  });

  it('falls back to tenants.timezone / config, then the default; invalid zones are skipped', async () => {
    const fromColumn = createTenantTimeZoneResolver({
      sources: sources({
        settingsTimezone: async () => 'Not/AZone',
        tenantRow: async () => ({ timezone: 'America/New_York' }),
      }),
    });
    await expect(fromColumn('t1')).resolves.toBe('America/New_York');
    const fromConfig = createTenantTimeZoneResolver({
      sources: sources({
        tenantRow: async () => ({ timezone: null, config: { locale: { timezone: 'Asia/Dubai' } } }),
      }),
    });
    await expect(fromConfig('t1')).resolves.toBe('Asia/Dubai');
    await expect(createTenantTimeZoneResolver({ sources: null })('t1')).resolves.toBe('UTC');
  });

  it('caches per tenant for the TTL and propagates lookup failures', async () => {
    let clock = 0;
    const settingsTimezone = vi.fn(async (tenantId: string) =>
      tenantId === 't1' ? 'Asia/Kolkata' : 'Europe/London',
    );
    const resolve = createTenantTimeZoneResolver({
      sources: sources({ settingsTimezone }),
      ttlMs: 1000,
      now: () => clock,
    });
    await resolve('t1');
    await resolve('t1');
    await expect(resolve('t2')).resolves.toBe('Europe/London');
    expect(settingsTimezone).toHaveBeenCalledTimes(2);
    clock = 2000;
    await resolve('t1');
    expect(settingsTimezone).toHaveBeenCalledTimes(3);
    const failing = createTenantTimeZoneResolver({
      sources: sources({
        settingsTimezone: async () => {
          throw new Error('db down');
        },
      }),
    });
    await expect(failing('t1')).rejects.toThrow('db down');
  });
});

describe('PRC-L104 gateway wiring', () => {
  let app: FastifyInstance | undefined;
  afterAll(async () => {
    await app?.close();
  });

  it('the examination plugin receives a tenant timezone resolver', async () => {
    delete process.env['DATABASE_URL'];
    const { buildApp } = await import('./app.js');
    app = await buildApp({
      config: {
        port: 0,
        host: '127.0.0.1',
        env: 'test',
        rateLimiting: { windowMs: 60000, maxRequests: 1000 },
        cors: { origins: ['http://localhost:3000'], methods: ['GET'], credentials: true },
        jwt: {
          secret: 'test-secret-key-for-testing-only',
          issuer: 'proctira-test',
          audience: 'proctira-test-api',
          accessTokenExpiresIn: '15m',
        },
        tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
        services: {
          auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
        },
      },
    });
    await app.ready();
    const timeZone = captured.options?.['timeZone'];
    expect(typeof timeZone).toBe('function');
    // No database in this test: the resolver answers the platform default.
    await expect(
      (timeZone as (tenantId: string) => Promise<string>)('550e8400-e29b-41d4-a716-446655440000'),
    ).resolves.toBe('UTC');
  }, 60_000);
});
