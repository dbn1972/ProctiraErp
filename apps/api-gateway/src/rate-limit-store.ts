/**
 * W1-ARCH-02 — cluster-wide rate-limit store policy.
 *
 * Prefer Redis when REDIS_URL is set so counters are shared across gateway
 * replicas. Refuse silent multi-replica in-memory limiting in production.
 */
import Redis from 'ioredis';

export type RateLimitStoreEnv = {
  NODE_ENV?: string;
  REDIS_URL?: string;
  /** Explicit single-replica emergency only — never set for multi-replica prod. */
  ALLOW_IN_MEMORY_RATE_LIMIT?: string;
};

export type RateLimitStoreDecision =
  | { mode: 'redis'; redisUrl: string }
  | { mode: 'memory'; reason: string };

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Decide whether rate limiting uses Redis or process-local memory.
 *
 * - REDIS_URL set → Redis (cluster-wide).
 * - production + REDIS_URL unset → throw unless ALLOW_IN_MEMORY_RATE_LIMIT is set
 *   (refuses silent multi-replica memory).
 * - non-production + REDIS_URL unset → in-memory (dev/test).
 */
export function decideRateLimitStore(env: RateLimitStoreEnv = process.env): RateLimitStoreDecision {
  const redisUrl = env.REDIS_URL?.trim();
  if (redisUrl) {
    return { mode: 'redis', redisUrl };
  }

  if (env.NODE_ENV === 'production' && !truthy(env.ALLOW_IN_MEMORY_RATE_LIMIT)) {
    throw new Error(
      'REDIS_URL is required for cluster-wide rate limiting in production (W1-ARCH-02). ' +
        'Set REDIS_URL, or set ALLOW_IN_MEMORY_RATE_LIMIT=1 only for explicit single-replica emergency.',
    );
  }

  return {
    mode: 'memory',
    reason:
      env.NODE_ENV === 'production'
        ? 'ALLOW_IN_MEMORY_RATE_LIMIT=1 (single-replica emergency)'
        : 'REDIS_URL unset (dev/test process-local store)',
  };
}

/**
 * Connect an ioredis client for @fastify/rate-limit.
 * Fails closed: connection errors propagate (no silent memory fallback).
 */
export async function createRateLimitRedisClient(redisUrl: string): Promise<Redis> {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    enableOfflineQueue: false,
    lazyConnect: true,
    // Rate-limit counters must not hang the request path indefinitely.
    commandTimeout: 2_000,
  });
  // Prevent ioredis from emitting unhandled 'error' during fail-closed connect.
  redis.on('error', () => undefined);

  try {
    await redis.connect();
    await redis.ping();
  } catch (err) {
    try {
      redis.disconnect();
    } catch {
      // ignore disconnect errors during fail-closed cleanup
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `REDIS_URL is set but Redis is unreachable for rate limiting (W1-ARCH-02 fail-closed): ${message}`,
    );
  }

  return redis;
}
