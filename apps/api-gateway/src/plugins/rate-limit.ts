/**
 * Rate Limit Plugin — Redis-backed distributed rate limiting
 *
 * Enhances @fastify/rate-limit with a Redis store for distributed
 * deployments. When REDIS_URL is set, rate limit counters are shared
 * across all gateway instances. Falls back to in-memory store when
 * Redis is unavailable.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';

export interface RateLimitPluginOptions {
  /** Maximum requests per window (default: 100) */
  max?: number;
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  timeWindow?: number;
  /** Redis URL for distributed rate limiting */
  redisUrl?: string;
}

async function rateLimitPlugin(
  app: FastifyInstance,
  options: RateLimitPluginOptions,
): Promise<void> {
  const { max = 100, timeWindow = 60_000, redisUrl } = options;

  // Use Redis store for distributed rate limiting when REDIS_URL is available
  const resolvedRedisUrl = redisUrl ?? process.env['REDIS_URL'];
  let redis: Redis | undefined;

  if (resolvedRedisUrl) {
    try {
      redis = new Redis(resolvedRedisUrl, {
        maxRetriesPerRequest: 2,
        retryStrategy: (times: number) => Math.min(times * 200, 2000),
        lazyConnect: true,
        enableOfflineQueue: false,
      });

      // Attempt connection — if it fails, fall back to in-memory
      await redis.connect();
      app.log.info('Rate limiter using Redis store for distributed limiting');
    } catch {
      app.log.warn('Redis unavailable for rate limiter — using in-memory store');
      redis = undefined;
    }
  }

  // Register @fastify/rate-limit with Redis store if available
  const { default: rateLimit } = await import('@fastify/rate-limit');

  await app.register(rateLimit, {
    max,
    timeWindow,
    redis,
    keyGenerator: (request) => {
      // Rate limit key priority: tenant + user > tenant > IP
      const tenantId = (request as unknown as { tenantId?: string }).tenantId;
      const userId = (request as unknown as { user?: { sub?: string } }).user?.sub;

      if (tenantId && userId) {
        return `rl:${tenantId}:${userId}`;
      }
      if (tenantId) {
        return `rl:tenant:${tenantId}`;
      }
      return `rl:ip:${request.ip}`;
    },
    allowList: [],
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // Graceful shutdown: disconnect Redis on close
  if (redis) {
    app.addHook('onClose', async () => {
      await redis?.quit();
    });
  }
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit-redis',
  fastify: '5.x',
});
