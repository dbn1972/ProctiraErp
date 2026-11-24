/**
 * PRC-M331 / PRC-M332: per-identifier throttles for anonymous registration
 * status lookups, keyed on (tenant, tracking number), and for anonymous
 * submits, keyed on (tenant, applicant identity).
 *
 * Not keyed on client IP: portal traffic reaches the backend from the portal
 * server, so a per-IP limit here would throttle every applicant together.
 * PRC-M332: in a deployed environment the counters live in Redis (REDIS_URL)
 * so every gateway replica enforces one budget; process-local sliding windows
 * are used only in development and test. The gateway's global
 * @fastify/rate-limit remains the outer limit.
 */
import { isDeployedEnvironment } from '@proctira/common/node-env';
import Redis from 'ioredis';

export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** One per-identifier limit; Redis-backed limiters resolve asynchronously. */
export interface ThrottleLimiter {
  /** Would another hit be allowed (without recording one)? */
  check(key: string): ThrottleDecision | Promise<ThrottleDecision>;
  /** Record a hit and return whether it was within the limit. */
  hit(key: string): ThrottleDecision | Promise<ThrottleDecision>;
}

const MAX_TRACKED_KEYS = 50_000;

export class SlidingWindowLimiter implements ThrottleLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  /** Would another hit be allowed (without recording one)? */
  check(key: string): ThrottleDecision {
    const list = this.recent(key);
    if (list.length < this.max) return { allowed: true, retryAfterSeconds: 0 };
    const oldest = list[0] ?? this.now();
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 1000)),
    };
  }

  /** Record a hit and return whether it was within the limit. */
  hit(key: string): ThrottleDecision {
    const decision = this.check(key);
    if (!decision.allowed) return decision;
    if (!this.hits.has(key) && this.hits.size >= MAX_TRACKED_KEYS) {
      const first = this.hits.keys().next().value;
      if (first !== undefined) this.hits.delete(first);
    }
    const list = this.hits.get(key) ?? [];
    list.push(this.now());
    this.hits.set(key, list);
    return decision;
  }

  count(key: string): number {
    return this.recent(key).length;
  }
}

/** Minimal ioredis surface for fixed-window counters. */
export interface RedisLikeForThrottle {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
}

/**
 * Replica-shared fixed-window counter: `INCR` then `PEXPIRE` on the first hit
 * of a window. Redis errors propagate so callers fail closed.
 */
export class RedisWindowLimiter implements ThrottleLimiter {
  constructor(
    private readonly redis: RedisLikeForThrottle,
    private readonly name: string,
    private readonly max: number,
    private readonly windowMs: number,
    private readonly keyPrefix = 'registration:throttle:',
  ) {}

  private key(key: string): string {
    return `${this.keyPrefix}${this.name}:${key}`;
  }

  private async retryAfter(redisKey: string): Promise<number> {
    const ttl = await this.redis.pttl(redisKey);
    return Math.max(1, Math.ceil((ttl > 0 ? ttl : this.windowMs) / 1000));
  }

  async check(key: string): Promise<ThrottleDecision> {
    const redisKey = this.key(key);
    const count = Number((await this.redis.get(redisKey)) ?? 0);
    if (count < this.max) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: await this.retryAfter(redisKey) };
  }

  async hit(key: string): Promise<ThrottleDecision> {
    const redisKey = this.key(key);
    const count = await this.redis.incr(redisKey);
    // First hit opens the window; a key left without a TTL is repaired here.
    if (count === 1 || (await this.redis.pttl(redisKey)) < 0) {
      await this.redis.pexpire(redisKey, this.windowMs);
    }
    if (count <= this.max) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: await this.retryAfter(redisKey) };
  }
}

export interface PublicThrottleConfig {
  /** Status lookups per tracking number per window (any outcome). */
  statusPerTracking: number;
  /** Failed (no-match) lookups per tracking number before lockout. */
  statusFailuresPerTracking: number;
  statusWindowMs: number;
  /** PRC-M132: public branding reads per client per window. */
  brandingPerClient: number;
  brandingWindowMs: number;
  /** PRC-M332: bot-challenge issuances per tenant per window. */
  challengePerTenant: number;
  challengeWindowMs: number;
  /** PRC-M332: anonymous submits per applicant identity (tenant + name + DOB + phone). */
  submitPerIdentifier: number;
  submitWindowMs: number;
}

export const DEFAULT_PUBLIC_THROTTLE: PublicThrottleConfig = {
  statusPerTracking: 10,
  statusFailuresPerTracking: 5,
  statusWindowMs: 15 * 60_000,
  brandingPerClient: 60,
  brandingWindowMs: 60_000,
  challengePerTenant: 600,
  challengeWindowMs: 60_000,
  submitPerIdentifier: 5,
  submitWindowMs: 60 * 60_000,
};

export interface PublicThrottleBackend {
  /** Shared Redis client; every limiter then counts in Redis. */
  redis?: RedisLikeForThrottle;
  keyPrefix?: string;
}

export class PublicRegistrationThrottle {
  readonly statusTracking: ThrottleLimiter;
  readonly statusFailures: ThrottleLimiter;
  /** PRC-M132: anonymous branding reads. */
  readonly brandingPerClient: ThrottleLimiter;
  /** PRC-M332: caps challenge minting per tenant (outer limit: gateway rate limiter). */
  readonly challengeIssuance: ThrottleLimiter;
  /** PRC-M332: anonymous submits per applicant identity. */
  readonly submitPerIdentifier: ThrottleLimiter;
  /** True when the counters are shared across replicas (Redis). */
  readonly shared: boolean;
  constructor(
    config: Partial<PublicThrottleConfig> = {},
    now?: () => number,
    backend: PublicThrottleBackend = {},
  ) {
    const c = { ...DEFAULT_PUBLIC_THROTTLE, ...config };
    const redis = backend.redis;
    this.shared = Boolean(redis);
    const limiter = (name: string, max: number, windowMs: number): ThrottleLimiter =>
      redis
        ? new RedisWindowLimiter(redis, name, max, windowMs, backend.keyPrefix)
        : new SlidingWindowLimiter(max, windowMs, now);
    this.brandingPerClient = limiter('branding', c.brandingPerClient, c.brandingWindowMs);
    this.statusTracking = limiter('status', c.statusPerTracking, c.statusWindowMs);
    this.statusFailures = limiter('status-fail', c.statusFailuresPerTracking, c.statusWindowMs);
    this.challengeIssuance = limiter('challenge', c.challengePerTenant, c.challengeWindowMs);
    this.submitPerIdentifier = limiter('submit', c.submitPerIdentifier, c.submitWindowMs);
  }
}

export interface PublicThrottleEnv {
  /** Shared Redis client (preferred). */
  redis?: RedisLikeForThrottle;
  /** Defaults to process.env.REDIS_URL; used only in a deployed environment. */
  REDIS_URL?: string;
  /** Defaults to process.env (NODE_ENV / APP_ENV / DEPLOY_ENV). */
  processEnv?: NodeJS.ProcessEnv;
  config?: Partial<PublicThrottleConfig>;
}

/**
 * PRC-M332: Redis counters when a client is injected or, in a deployed
 * environment, from REDIS_URL. A deployed process without Redis refuses to
 * start. Development and test keep process-local windows.
 */
export function createPublicRegistrationThrottle(
  env: PublicThrottleEnv = {},
): PublicRegistrationThrottle {
  if (env.redis) return new PublicRegistrationThrottle(env.config, undefined, { redis: env.redis });
  const processEnv = env.processEnv ?? process.env;
  if (!isDeployedEnvironment(processEnv['NODE_ENV'], processEnv)) {
    return new PublicRegistrationThrottle(env.config);
  }
  const redisUrl = (env.REDIS_URL ?? processEnv['REDIS_URL'])?.trim();
  if (!redisUrl) {
    throw new Error(
      'Public registration throttles need a shared Redis store (REDIS_URL) in a deployed environment (PRC-M332)',
    );
  }
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    lazyConnect: true,
  }) as unknown as RedisLikeForThrottle;
  return new PublicRegistrationThrottle(env.config, undefined, { redis });
}

/**
 * PRC-M332: applicant identity for the submit throttle. Case, spacing and
 * phone punctuation are normalised so trivial variations share one budget.
 */
export function submitIdentityKey(
  tenantId: string,
  input: { firstName: string; lastName: string; dateOfBirth: string; guardianPhone: string },
): string {
  const text = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const phone = input.guardianPhone.replace(/[^0-9]/g, '');
  return [tenantId, text(input.firstName), text(input.lastName), input.dateOfBirth.trim(), phone]
    .map((part) => encodeURIComponent(part))
    .join(':');
}
