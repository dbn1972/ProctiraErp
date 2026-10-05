/**
 * Failed-attempt limiter for the Keycloak ROPC `/auth/password` endpoint (PRC-H043).
 *
 * Two independent buckets are tracked:
 *  - per account (normalised username), regardless of source IP, so a
 *    distributed guess against one account still locks it;
 *  - per client IP, so one source cannot spray many accounts.
 *
 * Bucket state lives behind {@link PasswordThrottleState}. Production uses the shared Redis
 * store ({@link RedisPasswordThrottleState}, same client as rate limiting / token revocation) so
 * the limit holds across gateway replicas; the bounded in-process store is the dev/test fallback
 * and is refused in production (fail closed, same policy as W1-SEC-09). Keycloak realm
 * brute-force detection remains a separate backstop (infra).
 */
import { createHash } from 'node:crypto';

export type PasswordThrottleOptions = {
  /** Failed attempts per account inside the window before locking. Default 5. */
  maxAccountFailures?: number;
  /** Failed attempts per IP inside the window before locking. Default 20. */
  maxIpFailures?: number;
  /** Window for counting failures. Default 900s. */
  windowSeconds?: number;
  /** How long a bucket stays locked once the limit is hit. Default 900s. */
  lockSeconds?: number;
  /** Upper bound on tracked keys for the in-memory store. Default 50_000. */
  maxTrackedKeys?: number;
  /** Shared bucket state (Redis in production). Defaults to an in-memory store. */
  state?: PasswordThrottleState;
  now?: () => number;
};
export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Bucket storage shared by every replica in production. */
export interface PasswordThrottleState {
  /** Milliseconds the bucket stays locked (0 when not locked). */
  lockRemainingMs(key: string): Promise<number>;
  /** Count one failure; lock the bucket for `lockMs` once `limit` is reached inside `windowMs`. */
  recordFailure(key: string, limit: number, windowMs: number, lockMs: number): Promise<void>;
  /** Forget the bucket (failures and lock). */
  clear(key: string): Promise<void>;
}

type Bucket = { failures: number[]; lockedUntil: number };

/** Process-local bucket store (sliding window). Single replica only: dev/test fallback. */
export class MemoryPasswordThrottleState implements PasswordThrottleState {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxTrackedKeys: number;
  private readonly now: () => number;
  private windowMs = 0;

  constructor(options: { maxTrackedKeys?: number; now?: () => number } = {}) {
    this.maxTrackedKeys = positive(options.maxTrackedKeys, 50_000);
    this.now = options.now ?? Date.now;
  }

  async lockRemainingMs(key: string): Promise<number> {
    const bucket = this.buckets.get(key);
    const remaining = bucket ? bucket.lockedUntil - this.now() : 0;
    return remaining > 0 ? remaining : 0;
  }

  async recordFailure(key: string, limit: number, windowMs: number, lockMs: number): Promise<void> {
    const now = this.now();
    this.windowMs = windowMs;
    const bucket = this.buckets.get(key) ?? { failures: [], lockedUntil: 0 };
    bucket.failures = bucket.failures.filter((at) => now - at < windowMs);
    bucket.failures.push(now);
    if (bucket.failures.length >= limit) {
      bucket.lockedUntil = now + lockMs;
      bucket.failures = [];
    }
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    this.evict(now);
  }

  async clear(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  private evict(now: number): void {
    if (this.buckets.size <= this.maxTrackedKeys) return;
    for (const [key, bucket] of this.buckets) {
      const idle =
        bucket.lockedUntil <= now && bucket.failures.every((at) => now - at >= this.windowMs);
      if (idle) this.buckets.delete(key);
    }
    // Still over the cap: drop least-recently-updated entries (Map keeps insertion order).
    while (this.buckets.size > this.maxTrackedKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

/** Minimal ioredis-compatible surface used by {@link RedisPasswordThrottleState}. */
export interface RedisLikeForPasswordThrottle {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  pttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
}

/**
 * Atomic fixed-window failure count: INCR the counter (expiring with the window on first hit);
 * at the limit, set the lock key for lockMs and reset the counter.
 * KEYS[1] counter, KEYS[2] lock; ARGV[1] windowMs, ARGV[2] limit, ARGV[3] lockMs.
 */
const RECORD_FAILURE_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if n >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
end
return n
`;

/** Redis-backed bucket store: the failure budget and lock are shared by every replica. */
export class RedisPasswordThrottleState implements PasswordThrottleState {
  constructor(
    private readonly redis: RedisLikeForPasswordThrottle,
    private readonly prefix = 'auth:pwthrottle:',
  ) {}

  /** Usernames are hashed so account identifiers are not stored in Redis key names. */
  private redisKey(kind: 'fail' | 'lock', key: string): string {
    return `${this.prefix}${kind}:${createHash('sha256').update(key).digest('hex')}`;
  }

  async lockRemainingMs(key: string): Promise<number> {
    const ttl = await this.redis.pttl(this.redisKey('lock', key));
    return ttl > 0 ? ttl : 0;
  }

  async recordFailure(key: string, limit: number, windowMs: number, lockMs: number): Promise<void> {
    await this.redis.eval(
      RECORD_FAILURE_LUA,
      2,
      this.redisKey('fail', key),
      this.redisKey('lock', key),
      Math.max(1, Math.trunc(windowMs)),
      Math.max(1, Math.trunc(limit)),
      Math.max(1, Math.trunc(lockMs)),
    );
  }

  async clear(key: string): Promise<void> {
    await this.redis.del(this.redisKey('fail', key), this.redisKey('lock', key));
  }
}

export type PasswordThrottleStoreDecision =
  { mode: 'redis'; reason: string } | { mode: 'memory'; reason: string };

/** Redis when a shared client is available; memory only outside production (fail closed). */
export function decidePasswordThrottleStore(env: {
  redis?: RedisLikeForPasswordThrottle;
  NODE_ENV?: string;
}): PasswordThrottleStoreDecision {
  if (env.redis) return { mode: 'redis', reason: 'shared redis client injected (cluster-wide)' };
  if ((env.NODE_ENV ?? '').toLowerCase() === 'production') {
    throw new Error(
      'Shared password-login throttle store (REDIS_URL / redis) is required in production (PRC-H043).',
    );
  }
  return { mode: 'memory', reason: 'redis unset (dev/test process-local store)' };
}

export function createPasswordThrottleState(env: {
  redis?: RedisLikeForPasswordThrottle;
  NODE_ENV?: string;
}): PasswordThrottleState {
  const decision = decidePasswordThrottleStore(env);
  return decision.mode === 'redis' && env.redis
    ? new RedisPasswordThrottleState(env.redis)
    : new MemoryPasswordThrottleState();
}

export class PasswordLoginThrottle {
  private readonly maxAccountFailures: number;
  private readonly maxIpFailures: number;
  private readonly windowMs: number;
  private readonly lockMs: number;
  private readonly state: PasswordThrottleState;

  constructor(options: PasswordThrottleOptions = {}) {
    this.maxAccountFailures = positive(options.maxAccountFailures, 5);
    this.maxIpFailures = positive(options.maxIpFailures, 20);
    this.windowMs = positive(options.windowSeconds, 900) * 1000;
    this.lockMs = positive(options.lockSeconds, 900) * 1000;
    this.state =
      options.state ??
      new MemoryPasswordThrottleState({ maxTrackedKeys: options.maxTrackedKeys, now: options.now });
  }

  /** Check both buckets before contacting the IdP. Store errors propagate (caller fails closed). */
  async check(username: string, ip: string | undefined): Promise<ThrottleDecision> {
    const remaining = await Promise.all(
      this.keys(username, ip).map((key) => this.state.lockRemainingMs(key)),
    );
    const retryAfterMs = Math.max(0, ...remaining);
    if (retryAfterMs > 0) {
      return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }
    return { allowed: true };
  }

  async recordFailure(username: string, ip: string | undefined): Promise<void> {
    await Promise.all(
      this.keys(username, ip).map((key) =>
        this.state.recordFailure(
          key,
          key.startsWith('acct:') ? this.maxAccountFailures : this.maxIpFailures,
          this.windowMs,
          this.lockMs,
        ),
      ),
    );
  }

  /** Successful login clears the account bucket (IP bucket keeps counting). */
  async recordSuccess(username: string): Promise<void> {
    await this.state.clear(accountKey(username));
  }

  private keys(username: string, ip: string | undefined): string[] {
    const keys = [accountKey(username)];
    if (ip) keys.push(`ip:${ip}`);
    return keys;
  }
}

function accountKey(username: string): string {
  return `acct:${username.trim().toLowerCase()}`;
}
function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
