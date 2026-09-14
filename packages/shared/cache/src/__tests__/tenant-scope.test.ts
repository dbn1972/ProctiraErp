/**
 * W1-SEC-11 — tenant namespace enforcement for cache keys / CacheClient.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { tenantKey, configKey, listKey } from '../cache-keys.js';
import { CacheClient } from '../cache-client.js';
import {
  TenantScopeError,
  assertTenantScopedCacheKey,
  isTenantScopedCacheKey,
  shouldRequireTenantScopedCacheKeys,
} from '../tenant-scope.js';

function createMockRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return count;
    }),
    scan: vi.fn(async () => ['0', [] as string[]]),
    ping: vi.fn(async () => 'PONG'),
    quit: vi.fn(async () => 'OK'),
  };
}

describe('W1-SEC-11 cache tenant namespaces', () => {
  describe('key builders', () => {
    it('builds scoped keys', () => {
      expect(tenantKey('acme', 'student', '1')).toBe('t:acme:student:1');
      expect(configKey('acme', 'grading')).toBe('cfg:acme:grading');
      expect(listKey('acme', 'students', 'h1')).toBe('lst:acme:students:h1');
    });

    it('rejects missing tenant id', () => {
      expect(() => tenantKey('', 'student', '1')).toThrow(TenantScopeError);
      expect(() => configKey('   ', 'grading')).toThrow(TenantScopeError);
      expect(() => listKey('', 'students', 'h1')).toThrow(TenantScopeError);
    });
  });

  describe('assertTenantScopedCacheKey', () => {
    it('accepts known scoped shapes', () => {
      expect(isTenantScopedCacheKey('t:acme:student:1')).toBe(true);
      expect(isTenantScopedCacheKey('cfg:acme:grading')).toBe(true);
      expect(isTenantScopedCacheKey('lst:acme:students:abc')).toBe(true);
      expect(isTenantScopedCacheKey('tenant:acme:student:1')).toBe(true);
      expect(() => assertTenantScopedCacheKey('t:acme:student:1')).not.toThrow();
    });

    it('rejects unscoped names', () => {
      for (const key of ['user:1', 'student:1', 't::student:1', 'cfg::x', 'tenant::x', '', 'global']) {
        expect(isTenantScopedCacheKey(key)).toBe(false);
        expect(() => assertTenantScopedCacheKey(key)).toThrow(TenantScopeError);
      }
    });
  });

  describe('CacheClient production fail-closed', () => {
    let mockRedis: ReturnType<typeof createMockRedis>;

    beforeEach(() => {
      mockRedis = createMockRedis();
    });

    it('rejects unscoped keys when requireTenantScope is true', async () => {
      const cache = new CacheClient({
        redis: mockRedis as unknown as import('ioredis').default,
        requireTenantScope: true,
      });
      await expect(cache.get('user:1')).rejects.toThrow(TenantScopeError);
      await expect(cache.set('user:1', { a: 1 })).rejects.toThrow(TenantScopeError);
      await expect(cache.del('global')).rejects.toThrow(TenantScopeError);
    });

    it('allows scoped keys when enforcement is on', async () => {
      const cache = new CacheClient({
        redis: mockRedis as unknown as import('ioredis').default,
        requireTenantScope: true,
      });
      await cache.set('t:acme:student:1', { name: 'A' });
      expect(mockRedis.store.get('t:acme:student:1')).toBe('{"name":"A"}');
      await expect(cache.get('t:acme:student:1')).resolves.toEqual({ name: 'A' });
    });

    it('defaults to enforcement in production unless escape hatch set', () => {
      expect(shouldRequireTenantScopedCacheKeys({ NODE_ENV: 'production' })).toBe(true);
      expect(
        shouldRequireTenantScopedCacheKeys({
          NODE_ENV: 'production',
          ALLOW_UNSCOPED_TENANT_NAMESPACES: '1',
        }),
      ).toBe(false);
      expect(shouldRequireTenantScopedCacheKeys({ NODE_ENV: 'test' })).toBe(false);
    });
  });
});
