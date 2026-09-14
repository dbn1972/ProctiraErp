/**
 * @proctira/cache - Redis cache client with graceful degradation
 *
 * Provides a read-through caching layer backed by Redis.
 * If Redis is unavailable, operations fall through to the fetcher
 * without throwing — ensuring the application remains functional.
 *
 * W1-SEC-11: in production, keys must be tenant-scoped (fail closed).
 */
import Redis from 'ioredis';

import {
  assertTenantScopedCacheKey,
  shouldRequireTenantScopedCacheKeys,
} from './tenant-scope.js';

export interface CacheMetrics {
  hits: number;
  misses: number;
  errors: number;
}

export interface CacheClientOptions {
  /** Redis connection URL (e.g. redis://localhost:6379) */
  redisUrl?: string;
  /** Existing ioredis instance (takes precedence over redisUrl) */
  redis?: Redis;
  /** Key prefix applied to all operations */
  keyPrefix?: string;
  /** Default TTL in seconds when not specified per-call */
  defaultTtlSeconds?: number;
  /**
   * Require tenant-scoped keys (`t:|cfg:|lst:|tenant:`).
   * Defaults to true when `NODE_ENV=production` unless
   * `ALLOW_UNSCOPED_TENANT_NAMESPACES=1` (emergency only).
   */
  requireTenantScope?: boolean;
  /** Env override for production / escape-hatch detection (tests). */
  env?: NodeJS.ProcessEnv;
}

export class CacheClient {
  private redis: Redis | null = null;
  private readonly keyPrefix: string;
  private readonly defaultTtlSeconds: number;
  private readonly requireTenantScope: boolean;
  private readonly metrics: CacheMetrics = { hits: 0, misses: 0, errors: 0 };

  constructor(options: CacheClientOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? '';
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 300;
    this.requireTenantScope = shouldRequireTenantScopedCacheKeys(
      options.env ?? process.env,
      options.requireTenantScope,
    );

    if (options.redis) {
      this.redis = options.redis;
    } else if (options.redisUrl) {
      this.redis = new Redis(options.redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 2000),
        lazyConnect: true,
      });
    }
  }

  /**
   * Get a value from cache, parsed as JSON.
   * Returns null on miss or if Redis is unavailable.
   */
  async get<T>(key: string): Promise<T | null> {
    this.assertKey(key);
    if (!this.redis) return null;

    try {
      const raw = await this.redis.get(this.prefixKey(key));
      if (raw === null) {
        this.metrics.misses++;
        return null;
      }
      this.metrics.hits++;
      return JSON.parse(raw) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'TenantScopeError') throw error;
      this.metrics.errors++;
      return null;
    }
  }

  /**
   * Set a value in cache as JSON with optional TTL.
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.assertKey(key);
    if (!this.redis) return;

    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    try {
      const serialized = JSON.stringify(value);
      if (ttl > 0) {
        await this.redis.set(this.prefixKey(key), serialized, 'EX', ttl);
      } else {
        await this.redis.set(this.prefixKey(key), serialized);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TenantScopeError') throw error;
      this.metrics.errors++;
    }
  }

  /**
   * Delete a key from cache.
   */
  async del(key: string): Promise<void> {
    this.assertKey(key);
    if (!this.redis) return;

    try {
      await this.redis.del(this.prefixKey(key));
    } catch (error) {
      if (error instanceof Error && error.name === 'TenantScopeError') throw error;
      this.metrics.errors++;
    }
  }

  /**
   * Read-through cache pattern: get from cache, if miss call fetcher,
   * store result in cache, and return.
   * On Redis failure, falls through to fetcher (never throws).
   */
  async getOrSet<T>(key: string, fetcher: () => Promise<T>, ttlSeconds: number): Promise<T> {
    this.assertKey(key);
    // Try cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss — call fetcher
    const value = await fetcher();

    // Store in cache (fire-and-forget, don't block on cache write)
    void this.set(key, value, ttlSeconds);

    return value;
  }

  /**
   * Invalidate all keys matching a glob pattern using SCAN + DEL.
   * Returns the number of keys deleted.
   * Pattern must itself be tenant-scoped when enforcement is on
   * (e.g. `t:acme:student:*`).
   */
  async invalidatePattern(pattern: string): Promise<number> {
    this.assertKey(pattern.replace(/\*/g, 'x'));
    if (!this.redis) return 0;

    try {
      const prefixedPattern = this.prefixKey(pattern);
      let cursor = '0';
      let deletedCount = 0;

      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          prefixedPattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          await this.redis.del(...keys);
          deletedCount += keys.length;
        }
      } while (cursor !== '0');

      return deletedCount;
    } catch (error) {
      if (error instanceof Error && error.name === 'TenantScopeError') throw error;
      this.metrics.errors++;
      return 0;
    }
  }

  /**
   * Check if Redis is reachable via PING.
   */
  async isHealthy(): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Get current cache metrics (hits, misses, errors).
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics counters.
   */
  resetMetrics(): void {
    this.metrics.hits = 0;
    this.metrics.misses = 0;
    this.metrics.errors = 0;
  }

  /**
   * Disconnect from Redis gracefully.
   */
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  private assertKey(key: string): void {
    if (this.requireTenantScope) {
      assertTenantScopedCacheKey(key, 'CacheClient');
    }
  }

  private prefixKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
  }
}
