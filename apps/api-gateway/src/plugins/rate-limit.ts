/**
 * Rate Limit Plugin — Redis-backed distributed rate limiting (W1-ARCH-02)
 *
 * Enhances @fastify/rate-limit with a Redis store for distributed deployments.
 * When REDIS_URL is set, rate limit counters are shared across gateway replicas.
 * Production refuses silent in-memory multi-replica limiting; Redis connect
 * failures fail closed (no silent memory fallback).
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type Redis from 'ioredis';

import {
  createRateLimitRedisClient,
  decideRateLimitStore,
} from '../rate-limit-store.js';

export interface RateLimitPluginOptions {
  /** Maximum requests per window (default: 100) */
  max?: number;
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  timeWindow?: number;
  /** Redis URL for distributed rate limiting (overrides env) */
  redisUrl?: string;
  /** Env bag for tests; defaults to process.env */
  env?: NodeJS.ProcessEnv;
}

async function rateLimitPlugin(
  app: FastifyInstance,
  options: RateLimitPluginOptions,
): Promise<void> {
  const { max = 100, timeWindow = 60_000, redisUrl, env = process.env } = options;

  const decision = decideRateLimitStore({
    NODE_ENV: env['NODE_ENV'],
    REDIS_URL: redisUrl ?? env['REDIS_URL'],
    ALLOW_IN_MEMORY_RATE_LIMIT: env['ALLOW_IN_MEMORY_RATE_LIMIT'],
  });

  let redis: Redis | undefined;
  if (decision.mode === 'redis') {
    redis = await createRateLimitRedisClient(decision.redisUrl);
    app.log.info('Rate limiter using Redis store for distributed limiting (W1-ARCH-02)');
  } else {
    app.log.warn(
      { reason: decision.reason },
      'Rate limiter using in-memory store (single-process only; set REDIS_URL for multi-replica)',
    );
  }

  const { default: rateLimit } = await import('@fastify/rate-limit');

  await app.register(rateLimit, {
    max,
    timeWindow,
    redis,
    // Do not skip rate limiting when the store errors — fail closed.
    skipOnError: false,
    keyGenerator: (request) => {
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
