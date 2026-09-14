/**
 * W1-SEC-05 — durable registration portal session store factory.
 *
 * Prefer Redis (injected client or REDIS_URL) so language-session state survives
 * gateway restarts and is shared across replicas. Non-production may fall back
 * to {@link InMemorySessionStore} after {@link assertInMemoryFallbackAllowed}.
 * Production without a durable backend fails closed.
 */
import { assertInMemoryFallbackAllowed, readPersistencePolicyEnv } from '@proctira/database';
import Redis from 'ioredis';

import {
  InMemorySessionStore,
  type RegistrationSessionRecord,
  type RegistrationSessionStore,
} from './routes.js';

/** Minimal Redis surface (ioredis-compatible) for GET / SET EX / DEL. */
export interface RedisLikeForRegistrationSession {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
}

export type RegistrationSessionStoreEnv = {
  /** Shared Redis client (preferred when gateway already connected one). */
  redis?: RedisLikeForRegistrationSession;
  /** Redis URL — used when `redis` is not injected. Defaults to process.env.REDIS_URL. */
  REDIS_URL?: string;
  NODE_ENV?: string;
  DATABASE_URL?: string;
  REQUIRE_DATABASE?: string;
};

const DEFAULT_KEY_PREFIX = 'registration:session:';

/**
 * Redis-backed registration session store (JSON + EX TTL).
 * Throws on Redis errors so callers fail closed.
 */
export class RedisRegistrationSessionStore implements RegistrationSessionStore {
  constructor(
    private readonly redis: RedisLikeForRegistrationSession,
    private readonly keyPrefix = DEFAULT_KEY_PREFIX,
  ) {}

  async get(sessionId: string): Promise<RegistrationSessionRecord | null> {
    const raw = await this.redis.get(`${this.keyPrefix}${sessionId}`);
    if (raw == null) return null;
    let record: RegistrationSessionRecord;
    try {
      record = JSON.parse(raw) as RegistrationSessionRecord;
    } catch {
      await this.redis.del(`${this.keyPrefix}${sessionId}`);
      return null;
    }
    if (
      !record ||
      typeof record.expiresAtMs !== 'number' ||
      typeof record.clientBinding !== 'string' ||
      !record.data ||
      typeof record.data !== 'object'
    ) {
      await this.redis.del(`${this.keyPrefix}${sessionId}`);
      return null;
    }
    if (record.expiresAtMs <= Date.now()) {
      await this.redis.del(`${this.keyPrefix}${sessionId}`);
      return null;
    }
    return record;
  }

  async set(sessionId: string, record: RegistrationSessionRecord): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((record.expiresAtMs - Date.now()) / 1000));
    await this.redis.set(
      `${this.keyPrefix}${sessionId}`,
      JSON.stringify(record),
      'EX',
      ttlSeconds,
    );
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(`${this.keyPrefix}${sessionId}`);
  }
}

function createRedisClientFromUrl(redisUrl: string): RedisLikeForRegistrationSession {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    lazyConnect: true,
  });
}

/**
 * Build a registration session store.
 *
 * - Injected `redis` → {@link RedisRegistrationSessionStore}
 * - `REDIS_URL` set → Redis client + {@link RedisRegistrationSessionStore}
 * - otherwise → {@link InMemorySessionStore} after {@link assertInMemoryFallbackAllowed}
 *   (refuses `NODE_ENV=production` and `REQUIRE_DATABASE`)
 *
 * Note: language sessions are Redis-backed (W1-SEC-05), not Postgres. `DATABASE_URL`
 * alone does not imply a session table — we omit it from the memory-gate env so
 * gateway boots with PG repositories + Redis-less session memory remain valid in
 * non-production. Production still fails closed without Redis.
 */
export function createRegistrationSessionStore(
  env: RegistrationSessionStoreEnv = {},
): RegistrationSessionStore {
  if (env.redis) {
    return new RedisRegistrationSessionStore(env.redis);
  }

  const redisUrl = (env.REDIS_URL ?? process.env['REDIS_URL'])?.trim();
  if (redisUrl) {
    return new RedisRegistrationSessionStore(createRedisClientFromUrl(redisUrl));
  }

  assertInMemoryFallbackAllowed(
    'registration-session',
    readPersistencePolicyEnv({
      NODE_ENV: env.NODE_ENV ?? process.env['NODE_ENV'],
      // Intentionally omit DATABASE_URL — see factory note above.
      DATABASE_URL: undefined,
      REQUIRE_DATABASE: env.REQUIRE_DATABASE ?? process.env['REQUIRE_DATABASE'],
    }),
  );
  return new InMemorySessionStore();
}
