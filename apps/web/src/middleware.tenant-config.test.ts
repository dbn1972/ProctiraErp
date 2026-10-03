/**
 * @vitest-environment node
 *
 * PRC-M154: tenant-config lookup is bounded (timeout, LRU cap, slug shape, short
 * negative TTL) and suspended tenants are blocked on non-public paths.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _peekTenantConfigCache,
  clearTenantConfigCache,
  DEFAULT_TENANT_CONFIG,
  getTenantConfig,
  middleware,
  TENANT_CONFIG_CACHE_MAX_ENTRIES,
  TENANT_CONFIG_CACHE_TTL_MS,
  TENANT_CONFIG_FETCH_TIMEOUT_MS,
  TENANT_CONFIG_NEGATIVE_TTL_MS,
} from './middleware';

function okConfig(slug: string, active = true) {
  return { ok: true, json: async () => ({ id: `id-${slug}`, slug, name: slug, active }) };
}

describe('tenant config lookup bounds (PRC-M154)', () => {
  beforeEach(() => clearTenantConfigCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('caps the cache when 5000 distinct slugs are looked up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { headers: Record<string, string> }) =>
        okConfig(init.headers['X-Tenant-ID']!),
      ),
    );
    for (let i = 0; i < 5000; i += 1) await getTenantConfig(`t${i}`);
    expect(_peekTenantConfigCache('t0')).toBeUndefined();
    expect(_peekTenantConfigCache('t4999')).toBeDefined();
    let size = 0;
    for (let i = 0; i < 5000; i += 1) if (_peekTenantConfigCache(`t${i}`)) size += 1;
    expect(size).toBeLessThanOrEqual(TENANT_CONFIG_CACHE_MAX_ENTRIES);
  });

  it('maps malformed slugs to default instead of caching them', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await getTenantConfig('../../evil slug');
    expect(_peekTenantConfigCache('../../evil slug')).toBeUndefined();
    expect(_peekTenantConfigCache('default')).toBeDefined();
  });

  it('passes an abort signal so a hung gateway resolves within the timeout', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal = init.signal;
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    const started = Date.now();
    const config = await getTenantConfig('hung');
    expect(signal).toBeDefined();
    expect(config).toEqual(DEFAULT_TENANT_CONFIG);
    expect(Date.now() - started).toBeLessThan(TENANT_CONFIG_FETCH_TIMEOUT_MS + 1000);
  });

  it('caches failures only for the short negative TTL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    await getTenantConfig('flaky');
    const entry = _peekTenantConfigCache('flaky')!;
    expect(entry.expiresAt).toBeLessThanOrEqual(Date.now() + TENANT_CONFIG_NEGATIVE_TTL_MS);
    expect(entry.expiresAt).toBeLessThan(Date.now() + TENANT_CONFIG_CACHE_TTL_MS);
  });
});

describe('suspended tenant enforcement (PRC-M154)', () => {
  beforeEach(() => clearTenantConfigCache());
  afterEach(() => vi.unstubAllGlobals());

  it('redirects an active:false tenant to /tenant-suspended on protected paths', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okConfig('acme', false)));
    const response = await middleware(new NextRequest('https://acme.proctira.io/students'));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/tenant-suspended');
  });

  it('keeps public paths reachable for a suspended tenant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okConfig('acme', false)));
    const response = await middleware(new NextRequest('https://acme.proctira.io/tenant-suspended'));
    expect(response.headers.get('location')).toBeNull();
  });
});
