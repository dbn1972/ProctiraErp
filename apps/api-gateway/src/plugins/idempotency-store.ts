/**
 * W1-ARCH-03 — idempotency store selection (no silent memory degrade).
 *
 * Production / explicit redis: Redis is required. Missing client or Redis
 * failure must refuse boot or return 503 — never fall back to process memory.
 * Dev/test may set IDEMPOTENCY_STORE=memory explicitly (or omit REDIS_URL
 * outside production for the same single-process store).
 */

import type { RedisClient } from './idempotency.js';

export type IdempotencyStoreMode = 'redis' | 'memory';

export interface IdempotencyStorePolicyEnv {
  NODE_ENV?: string;
  REDIS_URL?: string;
  IDEMPOTENCY_STORE?: string;
  ALLOW_IN_MEMORY_IDEMPOTENCY?: string;
}

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Snapshot env into a typed bag (avoids unsafe ProcessEnv default params). */
export function readIdempotencyStoreEnv(
  source?: Record<string, string | undefined>,
): IdempotencyStorePolicyEnv {
  const env = source ?? {
    NODE_ENV: process.env['NODE_ENV'],
    REDIS_URL: process.env['REDIS_URL'],
    IDEMPOTENCY_STORE: process.env['IDEMPOTENCY_STORE'],
    ALLOW_IN_MEMORY_IDEMPOTENCY: process.env['ALLOW_IN_MEMORY_IDEMPOTENCY'],
  };
  return {
    NODE_ENV: env.NODE_ENV,
    REDIS_URL: env.REDIS_URL,
    IDEMPOTENCY_STORE: env.IDEMPOTENCY_STORE,
    ALLOW_IN_MEMORY_IDEMPOTENCY: env.ALLOW_IN_MEMORY_IDEMPOTENCY,
  };
}

/**
 * Resolve whether idempotency keys live in Redis or process memory.
 * Throws when memory is requested in production without an explicit allow flag.
 */
export function resolveIdempotencyStoreMode(
  env: IdempotencyStorePolicyEnv = readIdempotencyStoreEnv(),
): IdempotencyStoreMode {
  const explicit = env.IDEMPOTENCY_STORE?.trim().toLowerCase();

  if (explicit === 'memory') {
    if (env.NODE_ENV === 'production' && !truthy(env.ALLOW_IN_MEMORY_IDEMPOTENCY)) {
      throw new Error(
        '[idempotency] IDEMPOTENCY_STORE=memory is not allowed when NODE_ENV=production (set REDIS_URL / IDEMPOTENCY_STORE=redis, or ALLOW_IN_MEMORY_IDEMPOTENCY=1)',
      );
    }
    return 'memory';
  }

  if (explicit === 'redis') {
    return 'redis';
  }

  if (explicit) {
    throw new Error(
      `[idempotency] invalid IDEMPOTENCY_STORE=${explicit} (expected redis|memory)`,
    );
  }

  // Implicit: Redis whenever a URL is configured or we are in production.
  if (env.REDIS_URL?.trim()) return 'redis';
  if (env.NODE_ENV === 'production') return 'redis';

  // Dev/test without REDIS_URL — single-process memory (callers should prefer
  // IDEMPOTENCY_STORE=memory for honesty).
  return 'memory';
}

/** Refuse silent memory when Redis mode was selected but no client exists. */
export function assertIdempotencyRedisClient(
  mode: IdempotencyStoreMode,
  redis: RedisClient | undefined | null,
): asserts redis is RedisClient {
  if (mode === 'redis' && (redis == null)) {
    throw new Error(
      '[idempotency] Redis store required but client unavailable — refusing silent in-memory fallback (W1-ARCH-03)',
    );
  }
}

export interface ResolvedIdempotencyStore {
  mode: IdempotencyStoreMode;
  redis?: RedisClient;
}

type RedisCtor = new (
  url: string,
  options?: { lazyConnect?: boolean; maxRetriesPerRequest?: number; enableOfflineQueue?: boolean },
) => RedisClient & { quit?: () => Promise<unknown>; disconnect?: () => void };

/**
 * Build the gateway idempotency store from env.
 * When mode is redis, fails closed if REDIS_URL is missing or the client
 * cannot be constructed — never returns an implicit memory store.
 */
export async function resolveIdempotencyStore(
  env: IdempotencyStorePolicyEnv = readIdempotencyStoreEnv(),
  importRedis: () => Promise<{ default: RedisCtor }> = () =>
    import('ioredis') as Promise<{ default: RedisCtor }>,
): Promise<ResolvedIdempotencyStore> {
  const mode = resolveIdempotencyStoreMode(env);

  if (mode === 'memory') {
    return { mode };
  }

  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error(
      '[idempotency] REDIS_URL is required when IDEMPOTENCY_STORE=redis or NODE_ENV=production (W1-ARCH-03)',
    );
  }

  try {
    const ioredisMod = await importRedis();
    const RedisCtor = ioredisMod.default;
    const redis = new RedisCtor(redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    return { mode, redis };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[idempotency] Redis required but client could not be created — refusing in-memory fallback (W1-ARCH-03): ${detail}`,
    );
  }
}
