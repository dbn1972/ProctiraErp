import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheClient } from '../cache-client.js';

/**
 * Mock Redis client that simulates ioredis behavior in-memory.
 */
function createMockRedis() {
  const store = new Map<string, string>();

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ..._args: unknown[]) => {
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
    scan: vi.fn(async (_cursor: string, ..._args: unknown[]) => {
      // Simple mock: return all matching keys in one pass
      const matchArg = _args[_args.indexOf('MATCH') + 1] as string;
      const pattern = matchArg.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      const matchingKeys = [...store.keys()].filter((k) => regex.test(k));
      return ['0', matchingKeys];
    }),
    ping: vi.fn(async () => 'PONG'),
    quit: vi.fn(async () => 'OK'),
  };
}

describe('CacheClient', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let cache: CacheClient;

  beforeEach(() => {
    mockRedis = createMockRedis();
    cache = new CacheClient({ redis: mockRedis as unknown as import('ioredis').default });
  });

  describe('get', () => {
    it('returns parsed JSON value on cache hit', async () => {
      mockRedis.store.set('user:1', JSON.stringify({ name: 'Alice' }));

      const result = await cache.get<{ name: string }>('user:1');

      expect(result).toEqual({ name: 'Alice' });
      expect(cache.getMetrics().hits).toBe(1);
    });

    it('returns null on cache miss', async () => {
      const result = await cache.get('nonexistent');

      expect(result).toBeNull();
      expect(cache.getMetrics().misses).toBe(1);
    });

    it('returns null when Redis is not configured', async () => {
      const noRedisCache = new CacheClient();
      const result = await noRedisCache.get('any-key');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('stores JSON-serialized value with TTL', async () => {
      await cache.set('key1', { data: 'value' }, 60);

      expect(mockRedis.set).toHaveBeenCalledWith('key1', '{"data":"value"}', 'EX', 60);
      expect(mockRedis.store.get('key1')).toBe('{"data":"value"}');
    });

    it('uses default TTL when not specified', async () => {
      await cache.set('key2', 'hello');

      // Default TTL is 300
      expect(mockRedis.set).toHaveBeenCalledWith('key2', '"hello"', 'EX', 300);
    });
  });

  describe('del', () => {
    it('removes key from cache', async () => {
      mockRedis.store.set('to-delete', '"value"');

      await cache.del('to-delete');

      expect(mockRedis.del).toHaveBeenCalledWith('to-delete');
      expect(mockRedis.store.has('to-delete')).toBe(false);
    });

    it('does nothing when Redis is not configured', async () => {
      const noRedisCache = new CacheClient();
      // Should not throw
      await noRedisCache.del('any-key');
    });
  });

  describe('getOrSet', () => {
    it('returns cached value on hit without calling fetcher', async () => {
      mockRedis.store.set('cached', JSON.stringify({ id: 1 }));
      const fetcher = vi.fn().mockResolvedValue({ id: 2 });

      const result = await cache.getOrSet('cached', fetcher, 60);

      expect(result).toEqual({ id: 1 });
      expect(fetcher).not.toHaveBeenCalled();
      expect(cache.getMetrics().hits).toBe(1);
    });

    it('calls fetcher on miss and caches result', async () => {
      const fetcher = vi.fn().mockResolvedValue({ id: 42, name: 'Bob' });

      const result = await cache.getOrSet('new-key', fetcher, 120);

      expect(result).toEqual({ id: 42, name: 'Bob' });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(cache.getMetrics().misses).toBe(1);

      // Wait for fire-and-forget set to complete
      await new Promise((r) => setTimeout(r, 10));
      expect(mockRedis.store.get('new-key')).toBe(JSON.stringify({ id: 42, name: 'Bob' }));
    });

    it('gracefully degrades when Redis throws on get', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('Connection refused'));
      const fetcher = vi.fn().mockResolvedValue({ fallback: true });

      const result = await cache.getOrSet('broken', fetcher, 60);

      expect(result).toEqual({ fallback: true });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(cache.getMetrics().errors).toBe(1);
    });

    it('gracefully degrades when Redis is not configured', async () => {
      const noRedisCache = new CacheClient();
      const fetcher = vi.fn().mockResolvedValue({ data: 'from-fetcher' });

      const result = await noRedisCache.getOrSet('key', fetcher, 60);

      expect(result).toEqual({ data: 'from-fetcher' });
      expect(fetcher).toHaveBeenCalledOnce();
    });
  });

  describe('invalidatePattern', () => {
    it('deletes all keys matching pattern', async () => {
      mockRedis.store.set('user:1', '"a"');
      mockRedis.store.set('user:2', '"b"');
      mockRedis.store.set('order:1', '"c"');

      const deleted = await cache.invalidatePattern('user:*');

      expect(deleted).toBe(2);
      expect(mockRedis.store.has('user:1')).toBe(false);
      expect(mockRedis.store.has('user:2')).toBe(false);
      expect(mockRedis.store.has('order:1')).toBe(true);
    });
  });

  describe('isHealthy', () => {
    it('returns true when Redis responds to PING', async () => {
      const healthy = await cache.isHealthy();
      expect(healthy).toBe(true);
    });

    it('returns false when Redis is not configured', async () => {
      const noRedisCache = new CacheClient();
      const healthy = await noRedisCache.isHealthy();
      expect(healthy).toBe(false);
    });

    it('returns false when PING fails', async () => {
      mockRedis.ping.mockRejectedValueOnce(new Error('timeout'));
      const healthy = await cache.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe('metrics', () => {
    it('tracks hits and misses correctly', async () => {
      mockRedis.store.set('exists', '"val"');

      await cache.get('exists'); // hit
      await cache.get('exists'); // hit
      await cache.get('nope'); // miss

      const metrics = cache.getMetrics();
      expect(metrics.hits).toBe(2);
      expect(metrics.misses).toBe(1);
      expect(metrics.errors).toBe(0);
    });

    it('tracks errors on Redis failures', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('fail'));

      await cache.get('key');

      expect(cache.getMetrics().errors).toBe(1);
    });

    it('resets metrics', async () => {
      mockRedis.store.set('k', '"v"');
      await cache.get('k');
      cache.resetMetrics();

      expect(cache.getMetrics()).toEqual({ hits: 0, misses: 0, errors: 0 });
    });
  });

  describe('keyPrefix', () => {
    it('prefixes all keys when configured', async () => {
      const prefixedCache = new CacheClient({
        redis: mockRedis as unknown as import('ioredis').default,
        keyPrefix: 'app',
      });

      await prefixedCache.set('key', 'value', 60);

      expect(mockRedis.set).toHaveBeenCalledWith('app:key', '"value"', 'EX', 60);
    });
  });
});
