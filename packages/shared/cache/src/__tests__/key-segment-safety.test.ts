/**
 * PRC-L146 — cache key builders reject separator/glob characters in structural
 * segments, and invalidatePattern requires a literal tenant segment.
 */
import { describe, it, expect, vi } from 'vitest';
import { tenantKey, configKey, listKey } from '../cache-keys.js';
import { CacheClient } from '../cache-client.js';
import { TenantScopeError } from '../tenant-scope.js';

function mockRedis() {
  return {
    scan: vi.fn(async () => ['0', [] as string[]]),
    del: vi.fn(async () => 0),
    get: vi.fn(),
    set: vi.fn(),
    ping: vi.fn(),
    quit: vi.fn(),
  };
}

describe('PRC-L146 cache key segment safety', () => {
  it('rejects ":" in the entity segment', () => {
    expect(() => tenantKey('a', 'b:c', 'd')).toThrow(TenantScopeError);
  });

  it('rejects separator/glob characters in the tenant segment', () => {
    for (const bad of ['a:b', '*', 'a?', 'a[1]', 'a b']) {
      expect(() => tenantKey(bad, 'student', '1')).toThrow(TenantScopeError);
      expect(() => configKey(bad, 'grading')).toThrow(TenantScopeError);
      expect(() => listKey(bad, 'students', 'h')).toThrow(TenantScopeError);
    }
    expect(() => configKey('acme', 'grading:*')).toThrow(TenantScopeError);
  });

  it('keeps composite trailing ids working (backward compatible)', () => {
    expect(tenantKey('acme', 'roster', 'c1:p1')).toBe('t:acme:roster:c1:p1');
    expect(listKey('acme', 'institution', '{"a":1}')).toBe('lst:acme:institution:{"a":1}');
  });

  it('invalidatePattern rejects a wildcard tenant segment even when enforcement is off', async () => {
    const redis = mockRedis();
    const cache = new CacheClient({ redis: redis as never, requireTenantScope: false });
    await expect(cache.invalidatePattern('t:*:x:*')).rejects.toThrow(TenantScopeError);
    await expect(cache.invalidatePattern('lst:?cme:x:*')).rejects.toThrow(TenantScopeError);
    expect(redis.scan).not.toHaveBeenCalled();
  });

  it('invalidatePattern rejects a wildcard tenant segment under enforcement', async () => {
    const cache = new CacheClient({ redis: mockRedis() as never, requireTenantScope: true });
    await expect(cache.invalidatePattern('t:*:x:*')).rejects.toThrow(TenantScopeError);
    await expect(cache.invalidatePattern('t:acme:x:*')).resolves.toBe(0);
  });
});
