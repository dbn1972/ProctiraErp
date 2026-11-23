/**
 * PRC-M332 — single-use store for registration bot-challenge nonces.
 *
 * A solved proof-of-work token may be redeemed exactly once across every
 * gateway replica, so the nonce is claimed with Redis `SET <key> 1 EX <ttl> NX`
 * on the shared REDIS_URL client (same ioredis pattern as
 * create-registration-session-store.ts). Process memory is allowed only outside
 * a deployed environment.
 */
import { isDeployedEnvironment } from '@proctira/common/node-env';
import Redis from 'ioredis';

/** Claim a nonce once; false when it was already used (or is being used). */
export interface ChallengeNonceStore {
  claim(nonce: string, ttlSeconds: number): Promise<boolean>;
}

/** Minimal ioredis surface for `SET key value EX ttl NX`. */
export interface RedisLikeForChallengeNonce {
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
    condition: 'NX',
  ): Promise<string | null>;
}

const DEFAULT_KEY_PREFIX = 'registration:challenge-nonce:';

/** Replica-shared single-use claims. Redis errors propagate (callers fail closed). */
export class RedisChallengeNonceStore implements ChallengeNonceStore {
  constructor(
    private readonly redis: RedisLikeForChallengeNonce,
    private readonly keyPrefix = DEFAULT_KEY_PREFIX,
  ) {}

  async claim(nonce: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(
      `${this.keyPrefix}${nonce}`,
      '1',
      'EX',
      Math.max(1, Math.ceil(ttlSeconds)),
      'NX',
    );
    return result === 'OK';
  }
}

/** Process-local claims for development / test only. */
export class InMemoryChallengeNonceStore implements ChallengeNonceStore {
  private readonly claimed = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async claim(nonce: string, ttlSeconds: number): Promise<boolean> {
    const now = this.now();
    for (const [key, expiresAt] of this.claimed) if (expiresAt <= now) this.claimed.delete(key);
    if (this.claimed.has(nonce)) return false;
    this.claimed.set(nonce, now + Math.max(1, ttlSeconds) * 1000);
    return true;
  }
}

export interface ChallengeNonceStoreEnv {
  /** Shared Redis client (preferred). */
  redis?: RedisLikeForChallengeNonce;
  /** Defaults to process.env.REDIS_URL. */
  REDIS_URL?: string;
  /** Defaults to process.env (NODE_ENV / APP_ENV / DEPLOY_ENV). */
  processEnv?: NodeJS.ProcessEnv;
}

/**
 * Redis store when a client or REDIS_URL is available; process memory outside
 * a deployed environment; otherwise throws (deployed boot without Redis fails).
 */
export function createChallengeNonceStore(env: ChallengeNonceStoreEnv = {}): ChallengeNonceStore {
  if (env.redis) return new RedisChallengeNonceStore(env.redis);
  const processEnv = env.processEnv ?? process.env;
  const redisUrl = (env.REDIS_URL ?? processEnv['REDIS_URL'])?.trim();
  if (redisUrl) {
    return new RedisChallengeNonceStore(
      new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 2000),
        lazyConnect: true,
      }) as unknown as RedisLikeForChallengeNonce,
    );
  }
  if (isDeployedEnvironment(processEnv['NODE_ENV'], processEnv)) {
    throw new Error(
      'Registration bot-challenge nonces need a shared Redis store (REDIS_URL) in a deployed environment (PRC-M332)',
    );
  }
  return new InMemoryChallengeNonceStore();
}
