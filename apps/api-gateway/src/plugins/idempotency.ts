/**
 * Idempotency-Key Plugin
 *
 * Implements idempotency support for POST/PUT/PATCH requests to prevent
 * duplicate operations when the offline-first Sync_Queue replays requests.
 *
 * Behavior:
 * - Reads the `Idempotency-Key` header on POST/PUT/PATCH requests
 * - Stores the response for a given key in Redis with a configurable TTL (default 24h)
 * - If the same key is seen again, returns the cached response without re-executing the handler
 * - Returns 409 Conflict if the key is currently in-flight (concurrent duplicate request)
 * - GET/DELETE/OPTIONS/HEAD requests are not subject to idempotency checks
 *
 * Redis key structure:
 *   idempotency:{tenantId}:{key} → JSON { status, statusCode, headers, body }
 *   idempotency:{tenantId}:{key}:lock → "processing" (short TTL for in-flight detection)
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Options for the idempotency plugin.
 */
export interface IdempotencyOptions {
  /** TTL for cached responses in seconds (default: 86400 = 24 hours) */
  ttlSeconds?: number;
  /** TTL for the in-flight lock in seconds (default: 60) */
  lockTtlSeconds?: number;
  /** Header name for the idempotency key (default: 'idempotency-key') */
  headerName?: string;
  /** Redis client instance — must support get, set, del commands */
  redis?: RedisClient;
  /** Paths to exclude from idempotency checks */
  excludePaths?: string[];
}

/**
 * Minimal Redis client interface for the idempotency plugin.
 * Compatible with ioredis and node-redis.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
}

/**
 * Cached response stored in Redis.
 */
interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** HTTP methods that support idempotency */
const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH']);

const idempotencyPluginImpl: FastifyPluginAsync<IdempotencyOptions> = async (
  fastify: FastifyInstance,
  options: IdempotencyOptions = {},
) => {
  const {
    ttlSeconds = 86400, // 24 hours
    lockTtlSeconds = 60, // 1 minute lock for in-flight requests
    headerName = 'idempotency-key',
    redis,
    excludePaths = [],
  } = options;

  // If no Redis client is provided, skip idempotency enforcement (graceful degradation)
  if (!redis) {
    fastify.log.warn(
      'Idempotency plugin registered without Redis client — idempotency checks disabled',
    );
    return;
  }

  // Hook: onRequest — check for cached response or acquire lock
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only apply to write methods
    if (!IDEMPOTENT_METHODS.has(request.method)) return;

    // Check excluded paths
    const url = request.url.split('?')[0]!;
    const isExcluded = excludePaths.some((excluded) => {
      if (excluded.endsWith('/*')) {
        return url.startsWith(excluded.slice(0, -2));
      }
      return url === excluded;
    });
    if (isExcluded) return;

    // Read the idempotency key header
    const idempotencyKey = request.headers[headerName] as string | undefined;
    if (!idempotencyKey) return; // No key provided — proceed normally

    // Build Redis keys scoped to tenant
    const tenantId = (request as unknown as { tenantId?: string }).tenantId || 'global';
    const cacheKey = `idempotency:${tenantId}:${idempotencyKey}`;
    const lockKey = `${cacheKey}:lock`;

    // Check if there's already a cached response
    const cached = await redis.get(cacheKey);
    if (cached) {
      // Return the cached response without executing the handler
      const parsed: unknown = JSON.parse(cached);
      const cachedResponse = parsed as CachedResponse;
      reply.header('x-idempotency-replay', 'true');
      for (const [key, value] of Object.entries(cachedResponse.headers)) {
        reply.header(key, value);
      }
      return reply.status(cachedResponse.statusCode).send(JSON.parse(cachedResponse.body));
    }

    // Check if the request is currently in-flight (concurrent duplicate)
    const lockExists = await redis.get(lockKey);
    if (lockExists) {
      return reply.status(409).send({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'A request with this Idempotency-Key is already being processed',
        statusCode: 409,
      });
    }

    // Acquire the lock
    await redis.set(lockKey, 'processing', 'EX', lockTtlSeconds);

    // Store the key info on the request for the onSend hook
    (request as unknown as { _idempotencyKey: string })._idempotencyKey = idempotencyKey;
    (request as unknown as { _idempotencyCacheKey: string })._idempotencyCacheKey = cacheKey;
    (request as unknown as { _idempotencyLockKey: string })._idempotencyLockKey = lockKey;
  });

  // Hook: onSend — cache the response for future replays
  fastify.addHook(
    'onSend',
    async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      const idempotencyKey = (request as unknown as { _idempotencyKey?: string })._idempotencyKey;
      if (!idempotencyKey) return payload;

      const cacheKey = (request as unknown as { _idempotencyCacheKey: string })
        ._idempotencyCacheKey;
      const lockKey = (request as unknown as { _idempotencyLockKey: string })._idempotencyLockKey;

      // Only cache successful responses (2xx) and client errors (4xx)
      // Don't cache 5xx errors as they may be transient
      const statusCode = reply.statusCode;
      if (statusCode >= 500) {
        // Release the lock without caching
        await redis.del(lockKey);
        return payload;
      }

      // Serialize the response for caching
      const responseBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const headersToCache: Record<string, string> = {};

      // Cache select response headers
      const rawHeaders = reply.getHeaders();
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (key.startsWith('x-') || key === 'content-type' || key === 'location') {
          if (value !== undefined) {
            headersToCache[key] = String(value);
          }
        }
      }

      const cachedResponse: CachedResponse = {
        statusCode,
        headers: headersToCache,
        body: responseBody,
      };

      // Store in Redis with TTL
      await redis.set(cacheKey, JSON.stringify(cachedResponse), 'EX', ttlSeconds);

      // Release the lock
      await redis.del(lockKey);

      return payload;
    },
  );

  // Hook: onError — release the lock if the handler throws
  fastify.addHook('onError', async (request: FastifyRequest) => {
    const lockKey = (request as unknown as { _idempotencyLockKey?: string })._idempotencyLockKey;
    if (lockKey) {
      await redis.del(lockKey);
    }
  });
};

/**
 * Fastify plugin that provides Idempotency-Key support for write operations.
 * Prevents duplicate processing when the offline-first Sync_Queue replays requests.
 */
export const idempotencyPlugin = fp(idempotencyPluginImpl, {
  name: '@proctira/idempotency',
  fastify: '4.x',
});

export default idempotencyPlugin;
